import { afterEach, describe, expect, it, vi } from 'vitest';
import { emailProblem, storageProblem, testEmail, testPaystack, testStorage, paystackMode, testAlert } from '../lib/connections';
import { buildEnvelope, parseDsn, reportError, resetErrorReportMemory, scrub, cleanPath } from '../lib/errorReport';

afterEach(() => { vi.unstubAllGlobals(); resetErrorReportMemory(); });

const reply = (status: number, body = '') => (async () => new Response(body, { status })) as unknown as typeof fetch;

describe('the email test', () => {
  const env = { RESEND_API_KEY: 're_abc', EMAIL_FROM: 'Brandit <hello@thebrandit.ng>', NEXT_PUBLIC_APP_URL: 'https://thebrandit.ng' } as unknown as NodeJS.ProcessEnv;

  it('says what is missing when email is not set up', async () => {
    const r = await testEmail('me@x.ng', {} as any, reply(200));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/RESEND_API_KEY and EMAIL_FROM/);
  });

  it('sends one email through Resend with the key and sender, and reports success', async () => {
    let seen: any;
    const f = (async (url: string, init: any) => { seen = { url, init }; return new Response('{"id":"1"}', { status: 200 }); }) as unknown as typeof fetch;
    const r = await testEmail('me@x.ng', env, f, { confirm: false });
    expect(r.ok).toBe(true);
    expect(seen.url).toBe('https://api.resend.com/emails');
    expect(seen.init.headers.Authorization).toBe('Bearer re_abc');
    const body = JSON.parse(seen.init.body);
    expect(body).toMatchObject({ from: 'Brandit <hello@thebrandit.ng>', to: ['me@x.ng'] });
    expect(body.html).toContain('https://thebrandit.ng/brand/logo-horizontal.png');
  });

  it('explains Resend\'s common refusals in plain words, and never echoes the key', () => {
    expect(emailProblem(403, '{"message":"You can only send testing emails to your own email address (a@b.com). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address"}')).toMatch(/testing mode/);
    expect(emailProblem(403, '{"message":"The thebrandit.ng domain is not verified. Please, add and verify your domain"}')).toMatch(/not verified the domain/);
    expect(emailProblem(401, '{"name":"invalid_api_key","message":"API key is invalid"}')).toMatch(/does not accept RESEND_API_KEY/);
    expect(emailProblem(422, '{"message":"Invalid `from` field."}')).toMatch(/Brandit <hello@yourdomain.ng>/);
    expect(emailProblem(429, '')).toMatch(/too fast/);
    expect(emailProblem(500, 're_abc')).not.toMatch(/re_abc/);
  });

  it('says so when Resend cannot be reached', async () => {
    const r = await testEmail('me@x.ng', env, (async () => { throw new Error('fetch failed'); }) as any);
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/Could not reach Resend/);
  });
});

describe('the storage test', () => {
  const S3 = { S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', S3_BUCKET: 'brandit-files', S3_ACCESS_KEY_ID: 'AKID', S3_SECRET_ACCESS_KEY: 'secret' };
  afterEach(() => { for (const k of Object.keys(S3)) delete (process.env as any)[k]; });

  it('tells you a bucket is missing when there is none', async () => {
    const r = await testStorage();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/No bucket is set up/);
  });

  it('saves, reads back and deletes a file, and says so', async () => {
    Object.assign(process.env, S3);
    const store = new Map<string, Uint8Array>();
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const key = req.url;
      if (req.method === 'PUT') { store.set(key, new Uint8Array(await req.arrayBuffer())); return new Response(null, { status: 200 }); }
      if (req.method === 'GET') return store.has(key) ? new Response(store.get(key) as any) : new Response('', { status: 404 });
      store.delete(key); return new Response(null, { status: 204 });
    }));
    const r = await testStorage();
    expect(r).toEqual({ ok: true, message: expect.stringMatching(/saved, read back and deleted/) });
    expect(store.size).toBe(0);
  });

  it('turns a bad secret into an instruction, naming the step it stopped at', async () => {
    Object.assign(process.env, S3);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403 })));
    const r = await testStorage();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Stopped after: nothing/);
    expect(r.message).toMatch(/S3_SECRET_ACCESS_KEY/);
    expect(r.message).not.toMatch(/secret"|AKID/);
  });

  it('maps the other refusals', () => {
    expect(storageProblem('Storage upload failed (404 NoSuchBucket)')).toMatch(/bucket was not found/);
    expect(storageProblem('Storage upload failed (403 AccessDenied)')).toMatch(/Object Read & Write/);
    expect(storageProblem('Storage upload failed (403 InvalidAccessKeyId)')).toMatch(/Access Key ID/);
    expect(storageProblem('fetch failed')).toMatch(/S3_ENDPOINT/);
  });
});

describe('the Paystack test', () => {
  it('knows live from test keys', () => {
    expect(paystackMode('sk_live_abc')).toBe('live');
    expect(paystackMode('sk_test_abc')).toBe('test');
    expect(paystackMode('pk_live_abc')).toBe('unknown');
    expect(paystackMode(undefined)).toBe('unknown');
  });
  it('refuses a public key and explains', async () => {
    const r = await testPaystack({ PAYSTACK_SECRET_KEY: 'pk_live_abc' } as any, reply(200));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Secret key/);
  });
  it('proves a key without moving money, and warns that a live key is live', async () => {
    let seen: any;
    const f = (async (url: string, init: any) => { seen = { url, init }; return new Response('{"status":true}', { status: 200 }); }) as unknown as typeof fetch;
    const r = await testPaystack({ PAYSTACK_SECRET_KEY: 'sk_live_abc', NEXT_PUBLIC_APP_URL: 'https://thebrandit.ng' } as any, f, { initialize: false });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/LIVE key/);
    expect(r.message).toContain('https://thebrandit.ng/api/webhooks/paystack');
    expect(seen.url).toMatch(/^https:\/\/api\.paystack\.co\/bank/);
    expect(seen.init.method).toBeUndefined();   // a read, never a payment
  });
  it('reports a rejected key', async () => {
    const r = await testPaystack({ PAYSTACK_SECRET_KEY: 'sk_test_abc' } as any, reply(401, '{"status":false}'));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/does not accept this key/);
  });
});

describe('the Paystack test also starts one unpaid payment', () => {
  const env = { PAYSTACK_SECRET_KEY: 'sk_live_abc', NEXT_PUBLIC_APP_URL: 'https://thebrandit.ng' } as any;
  const paystack = (initStatus: number, initBody: unknown) => {
    const calls: { url: string; body?: any }[] = [];
    const f = (async (url: string, init: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.includes('/bank')) return new Response('{"status":true}', { status: 200 });
      return new Response(JSON.stringify(initBody), { status: initStatus });
    }) as unknown as typeof fetch;
    return { calls, f };
  };
  it('starts a N100 payment, leaves it unpaid, and says so', async () => {
    const { calls, f } = paystack(200, { status: true, data: { authorization_url: 'https://checkout.paystack.com/x', reference: 'r' } });
    const r = await testPaystack(env, f);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/started one N100 payment and left it unpaid/);
    const init = calls.find((c) => c.url.includes('transaction/initialize'))!;
    expect(init.body.amount).toBe(10000);
    expect(init.body.currency).toBe('NGN');
    expect(init.body.email).toBe('healthcheck@thebrandit.ng');
    expect(init.body.reference).toMatch(/^HC-/);
    expect(init.body.metadata).toEqual({ healthcheck: true });
  });
  it('explains an account that is not approved for live payments', async () => {
    const r = await testPaystack(env, paystack(403, { status: false, message: 'Your business is not activated to go live' }).f);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not approved for live payments/);
  });
  it('reports any other refusal in plain words', async () => {
    const r = await testPaystack(env, paystack(400, { status: false, message: 'Invalid amount' }).f);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/would not start a test payment \(400: Invalid amount\)/);
  });
  it('can be switched off', async () => {
    const { calls, f } = paystack(200, {});
    expect((await testPaystack(env, f, { initialize: false })).ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('the email test confirms delivery when Resend will say', () => {
  const env = { RESEND_API_KEY: 're_abc', EMAIL_FROM: 'Brandit <hello@thebrandit.ng>', NEXT_PUBLIC_APP_URL: 'https://thebrandit.ng' } as unknown as NodeJS.ProcessEnv;
  const resend = (events: (string | number)[]) => {
    let polls = 0;
    const calls: string[] = [];
    const f = (async (url: string, init: any) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'POST') return new Response('{"id":"em_123"}', { status: 200 });
      const e = events[Math.min(polls++, events.length - 1)];
      return typeof e === 'number' ? new Response('{"message":"restricted"}', { status: e }) : new Response(JSON.stringify({ last_event: e }), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, f };
  };
  const opts = { sleep: async () => {}, waitMs: 60_000 };

  it('says it was delivered once Resend reports delivered, polling until then', async () => {
    const { calls, f } = resend(['sent', 'sent', 'delivered']);
    const r = await testEmail('me@x.ng', env, f, opts);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Resend confirms it was delivered/);
    expect(calls.filter((c) => c.startsWith('GET')).length).toBe(3);
    expect(calls.find((c) => c.startsWith('GET'))).toContain('/emails/em_123');
  });
  it('fails, and says why, when the address bounced', async () => {
    const r = await testEmail('nobody@x.ng', env, resend(['bounced']).f, opts);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/nobody@x\.ng refused it \(it bounced\)/);
  });
  it('says delivery is not confirmed yet if Resend is still working on it after the wait', async () => {
    const r = await testEmail('me@x.ng', env, resend(['sent']).f, { sleep: async () => {}, waitMs: 0 });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/not confirmed delivery yet \(sent\)/);
  });
  it('still passes with a send-only key, and says it cannot tell', async () => {
    const r = await testEmail('me@x.ng', env, resend([401]).f, opts);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/can only send/);
  });
  it('can skip the confirmation', async () => {
    const { calls, f } = resend(['delivered']);
    expect((await testEmail('me@x.ng', env, f, { confirm: false })).ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('error alerts', () => {
  const dsn = 'https://abc123key@o99.ingest.sentry.io/4507';

  it('reads a Sentry address and rejects anything else', () => {
    expect(parseDsn(dsn)).toEqual({ endpoint: 'https://o99.ingest.sentry.io/api/4507/envelope/', key: 'abc123key' });
    expect(parseDsn('https://abc@sentry.example.com/sub/12')).toEqual({ endpoint: 'https://sentry.example.com/sub/api/12/envelope/', key: 'abc' });
    for (const bad of [undefined, '', 'not a url', 'https://sentry.io/123', 'https://key@sentry.io/', 'https://key@sentry.io/abc']) expect(parseDsn(bad as any), String(bad)).toBeNull();
  });

  it('blanks database addresses, keys and tokens, and drops the query string', () => {
    const t = scrub('connect postgres://admin:hunter2@dpg-abc-a.frankfurt-postgres.render.com/brandit failed; key sk_live_AbC123 re_abcdefghijklmnop Bearer eyJhbGciOi.x.y');
    expect(t).not.toMatch(/hunter2|sk_live_AbC123|re_abcdefghijklmnop|eyJhbGciOi/);
    expect(cleanPath('/pay/return?reference=ABC-123&trxref=Z')).toBe('/pay/return');
  });

  it('builds an envelope with no cookies, headers or customer data', () => {
    const err = Object.assign(new Error('boom for postgres://u:pw@h/db'), { digest: 'd1' });
    const env = buildEnvelope(err, { path: '/track/BR-1?code=999', method: 'GET', routePath: '/track/[code]', routeType: 'render' }, dsn, { APP_ENV: 'staging', RENDER_GIT_COMMIT: 'abcdef1234567890' } as any, 'e'.repeat(32), new Date('2026-10-16T10:00:00Z'));
    const [head, type, ev] = env.split('\n').map((l) => JSON.parse(l));
    expect(head).toMatchObject({ dsn, event_id: 'e'.repeat(32) });
    expect(type).toEqual({ type: 'event' });
    expect(ev).toMatchObject({ level: 'error', environment: 'staging', release: 'abcdef123456', request: { url: '/track/BR-1', method: 'GET' }, tags: { route: '/track/[code]', digest: 'd1' } });
    expect(env).not.toMatch(/pw@h|code=999/);
  });

  it('does nothing without SENTRY_DSN, sends once with it, and stays quiet about repeats', async () => {
    const calls: any[] = [];
    const f = (async (url: string, init: any) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    expect(await reportError(new Error('x'), {}, {} as any, f)).toBe(false);
    expect(calls).toHaveLength(0);
    const env = { SENTRY_DSN: dsn } as any;
    expect(await reportError(new Error('same'), { routePath: '/a' }, env, f, 1_000_000)).toBe(true);
    expect(await reportError(new Error('same'), { routePath: '/a' }, env, f, 1_000_000 + 60_000)).toBe(false);          // one minute later: still quiet
    expect(await reportError(new Error('same'), { routePath: '/a' }, env, f, 1_000_000 + 6 * 60_000)).toBe(true);        // six minutes later: again
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://o99.ingest.sentry.io/api/4507/envelope/');
    expect(calls[0].init.headers['X-Sentry-Auth']).toContain('sentry_key=abc123key');
  });

  it('caps a storm at 30 an hour and never throws', async () => {
    const f = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const env = { SENTRY_DSN: dsn } as any;
    let sent = 0;
    for (let i = 0; i < 40; i++) if (await reportError(new Error(`different ${i}`), {}, env, f, 5_000_000 + i)) sent++;
    expect(sent).toBe(30);
    const boom = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    resetErrorReportMemory();
    await expect(reportError(new Error('y'), {}, env, boom)).resolves.toBe(false);
  });
});

describe('the alert test', () => {
  const dsn = 'https://abc123key@o99.ingest.sentry.io/4507';
  it('explains a missing or wrong SENTRY_DSN', async () => {
    expect((await testAlert({} as any, reply(200))).message).toMatch(/no SENTRY_DSN/);
    expect((await testAlert({ SENTRY_DSN: 'nope' } as any, reply(200))).message).toMatch(/not a Sentry address/);
  });
  it('sends one test event and says where to look, even if an identical one was sent a minute ago', async () => {
    const calls: string[] = [];
    const f = (async (_u: string, init: any) => { calls.push(init.body); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const r = await testAlert({ SENTRY_DSN: dsn } as any, f);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Open Sentry, Issues/);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('Brandit test alert');
  });
  it('says so when Sentry refuses it', async () => {
    const r = await testAlert({ SENTRY_DSN: dsn } as any, reply(403));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/did not accept/);
  });
});
