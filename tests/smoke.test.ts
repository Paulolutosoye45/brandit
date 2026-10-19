import { describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { runSmoke, failed, formatRows } from '../lib/smoke';

type Handler = (req: http.IncomingMessage, body: string) => { status?: number; headers?: Record<string, string | undefined>; body?: string };

/** A pretend Brandit on a local port, so the smoke test is tested without any real site. */
async function fake(handler: Handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const r = handler(req, body);
      res.writeHead(r.status ?? 200, Object.fromEntries(Object.entries(r.headers ?? {}).filter(([, v]) => v !== undefined)) as Record<string, string>);
      res.end(r.body ?? '');
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

const goodSite = (base: () => string, extra: { staging?: boolean } = {}): Handler => (req, body) => {
  const url = req.url ?? '/';
  const sec = { 'x-content-type-options': 'nosniff', ...(extra.staging ? { 'x-robots-tag': 'noindex, nofollow' } : {}) };
  if (url === '/api/health') return { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, db: 'up', mode: 'live', site: extra.staging ? 'staging' : 'production', build: 'abc1234' }) };
  if (url === '/') return { headers: { 'content-type': 'text/html', ...sec }, body: '<title>Brandit</title>' };
  if (url === '/sitemap.xml') return { body: `<urlset><url><loc>${base()}/</loc></url><url><loc>${base()}/products/business-cards</loc></url></urlset>` };
  if (url === '/robots.txt') return { body: extra.staging ? 'User-Agent: *\nDisallow: /' : 'User-Agent: *\nAllow: /\nSitemap: x/sitemap.xml' };
  if (url === '/products/business-cards') return { body: 'ok' };
  if (url === '/api/quote') return { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, total: 1500000, got: JSON.parse(body).slug }) };
  if (url === '/console') return { status: 307, headers: { location: '/console/login' } };
  if (url === '/console/login') return { body: '<form>Team sign-in</form>' };
  if (url === '/signin') return { body: '<button>Continue with Google</button><input type="email">' };
  return { status: 404, body: 'not found' };
};

describe('the after-deploy smoke test', () => {
  it('passes a healthy live site', async () => {
    let base = '';
    const s = await fake(goodSite(() => base));
    base = s.base;
    try {
      const rows = await runSmoke(s.base, { allowDemo: false });
      expect(rows.filter((r) => r.status === 'fail'), formatRows(rows)).toEqual([]);
      expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(['Health check', 'Home page', 'Sitemap', 'robots.txt', 'Product page', 'Price quote', 'Missing page', 'Console sign-in', 'Customer sign-in']));
      expect(rows.find((r) => r.name === 'Customer sign-in')!.detail).toMatch(/Google, email/);
      expect(rows.find((r) => r.name === 'Health check')!.detail).toMatch(/build abc1234/);
    } finally { await s.close(); }
  });

  it('passes a healthy test site only when asked for one, and checks it hides from search engines', async () => {
    let base = '';
    const s = await fake(goodSite(() => base, { staging: true }));
    base = s.base;
    try {
      expect(failed(await runSmoke(s.base, { staging: true }))).toBe(0);
      const asReal = await runSmoke(s.base, {});
      expect(asReal.find((r) => r.name === 'Health check')!.detail).toMatch(/staging site, but you asked for production/);
      expect(asReal.find((r) => r.name === 'Search engines')!.status).toBe('fail');
    } finally { await s.close(); }
  });

  it('sends the team password to a protected test site, and says so when it is wrong', async () => {
    const seen: (string | undefined)[] = [];
    const s = await fake((req) => {
      seen.push(req.headers.authorization);
      if (req.headers.authorization !== `Basic ${Buffer.from('team:s3cret').toString('base64')}` && req.url !== '/api/health') return { status: 401 };
      return { status: req.url === '/api/health' && req.headers.authorization !== `Basic ${Buffer.from('team:s3cret').toString('base64')}` ? 401 : 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, db: 'up', mode: 'live', site: 'staging' }) };
    });
    try {
      const good = await runSmoke(s.base, { staging: true, password: 's3cret' });
      expect(good.find((r) => r.name === 'Health check')!.status).toBe('pass');
      const bad = await runSmoke(s.base, { staging: true, password: 'nope' });
      expect(bad.find((r) => r.name === 'Health check')!.detail).toMatch(/password was refused/);
    } finally { await s.close(); }
  });

  it('fails loudly on the things that must never reach customers', async () => {
    let base = '';
    const h = goodSite(() => base);
    const s = await fake((req, body) => {
      if (req.url === '/api/health') return { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, db: 'up', mode: 'demo', site: 'production' }) };
      if (req.url === '/robots.txt') return { body: 'User-agent: *\nDisallow: /' };
      if (req.url === '/console') return { status: 200, body: 'open console' };
      if (req.url === '/console/login') return { body: 'Sign in as admin@brandit.test, PIN 1234' };
      if (req.url === '/') return { headers: { 'x-robots-tag': 'noindex' }, body: 'Brandit' };
      return h(req, body);
    });
    base = s.base;
    try {
      const rows = await runSmoke(s.base, {});
      const bad = new Map(rows.filter((r) => r.status === 'fail').map((r) => [r.name, r.detail]));
      expect(bad.get('Health check')).toMatch(/demo mode/);
      expect(bad.get('robots.txt')).toMatch(/Blocks the whole site/);
      expect(bad.get('Search engines')).toMatch(/noindex/);
      expect(bad.get('Console sign-in')).toMatch(/instead of sending them to sign in/);
      expect(failed(rows)).toBeGreaterThanOrEqual(4);
      expect(formatRows(rows)).toMatch(/FAILED. Do not announce the site yet/);
    } finally { await s.close(); }
  });

  it('follows /console through more than one redirect, as the real site does (queue, then sign-in)', async () => {
    let base = '';
    const h = goodSite(() => base);
    const s = await fake((req, body) => {
      if (req.url === '/console') return { status: 307, headers: { location: '/console/queue' } };
      if (req.url === '/console/queue') return { status: 307, headers: { location: '/console/login?next=%2Fconsole%2Fqueue' } };
      if (req.url?.startsWith('/console/login')) return { body: '<form>Team sign-in</form>' };
      return h(req, body);
    });
    base = s.base;
    try {
      expect((await runSmoke(s.base, {})).find((r) => r.name === 'Console sign-in')).toMatchObject({ status: 'pass' });
    } finally { await s.close(); }
  });

  it('fails when a stranger can read a console page without signing in', async () => {
    let base = '';
    const h = goodSite(() => base);
    const s = await fake((req, body) => (req.url === '/console' ? { status: 307, headers: { location: '/console/queue' } } : req.url === '/console/queue' ? { body: 'All the orders' } : h(req, body)));
    base = s.base;
    try {
      expect((await runSmoke(s.base, {})).find((r) => r.name === 'Console sign-in')!.detail).toMatch(/\/console\/queue.*instead of sending them to sign in/);
    } finally { await s.close(); }
  });

  it('stops with one clear line when the test-site password is missing, instead of a wall of 401s', async () => {
    const s = await fake((req) => (req.url === '/api/health' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, db: 'up', mode: 'live', site: 'staging' }) } : { status: 401 }));
    try {
      const rows = await runSmoke(s.base, { staging: true });
      expect(rows.map((r) => r.name)).toEqual(['Health check', 'Home page']);
      expect(rows[1].detail).toMatch(/team password/);
    } finally { await s.close(); }
  });

  it('reports a site that is down instead of crashing', async () => {
    const rows = await runSmoke('http://127.0.0.1:1', {});
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === 'fail')).toBe(true);
    expect(rows[0].detail).toMatch(/Could not complete/);
  });

  it('warns about a slow page without failing it', async () => {
    let base = '';
    const h = goodSite(() => base);
    const s = await fake((req, body) => h(req, body));
    base = s.base;
    try {
      const rows = await runSmoke(s.base, { slowMs: -1 });   // everything counts as slow
      expect(rows.find((r) => r.name === 'Home page')!.status).toBe('warn');
      expect(failed(rows)).toBe(0);
    } finally { await s.close(); }
  });
});

describe('the deep checks in the smoke test', () => {
  const withDeep = (deep: (req: http.IncomingMessage) => { status?: number; body?: unknown }): ((base: () => string) => Handler) => (base) => (req, body) => {
    if ((req.url ?? '').startsWith('/api/health/deep')) {
      const r = deep(req);
      return { status: r.status ?? 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(r.body ?? {}) };
    }
    return goodSite(base)(req, body);
  };
  const run = async (handler: (base: () => string) => Handler, opts: Parameters<typeof runSmoke>[1]) => {
    let base = '';
    const s = await fake(handler(() => base));
    base = s.base;
    try { return await runSmoke(s.base, opts); } finally { await s.close(); }
  };

  it('is not asked for unless wanted', async () => {
    const seen: string[] = [];
    const rows = await run(withDeep((req) => { seen.push(req.url!); return {}; }), {});
    expect(seen).toEqual([]);
    expect(rows.some((r) => r.name.startsWith('Deep'))).toBe(false);
  });

  it('shows each check as its own row, sends the secret, and asks for the extras only when told', async () => {
    const seen: { url: string; auth?: string }[] = [];
    const handler = withDeep((req) => {
      seen.push({ url: req.url!, auth: req.headers.authorization });
      return { body: { ok: true, checks: [
        { id: 'database', label: 'Database', ok: true, detail: 'Answers.', ms: 4 },
        { id: 'storage', label: 'File storage', ok: true, detail: 'The bucket works.', ms: 380 },
        { id: 'email', label: 'Email', ok: true, skipped: true, detail: 'Skipped: no email was sent.', ms: 0 },
      ] } };
    });
    const rows = await run(handler, { deep: { secret: 's3cret' } });
    expect(seen[0]).toEqual({ url: '/api/health/deep', auth: 'Bearer s3cret' });
    expect(rows.find((r) => r.name === 'Deep: Database')).toMatchObject({ status: 'pass', detail: 'Answers. (4 ms)' });
    expect(rows.find((r) => r.name === 'Deep: File storage')!.detail).toMatch(/bucket works/);
    expect(rows.find((r) => r.name === 'Deep: Email')!.detail).toBe('Skipped: no email was sent.');
    expect(failed(rows)).toBe(0);
    await run(handler, { deep: { secret: 's3cret', full: true, email: 'me@x.ng' } });
    expect(seen[1].url).toBe('/api/health/deep?full=1&email=me%40x.ng');
  });

  it('fails the run when a deep check fails, saying which', async () => {
    const rows = await run(withDeep(() => ({ status: 503, body: { ok: false, checks: [{ id: 'backup', label: 'Backup', ok: false, detail: 'The newest backup is 40 hours old.', ms: 9 }] } })), { deep: { secret: 'x' } });
    expect(rows.find((r) => r.name === 'Deep: Backup')).toMatchObject({ status: 'fail' });
    expect(failed(rows)).toBe(1);
  });

  it('says plainly when the secret is wrong or the site is too old', async () => {
    const wrong = await run(withDeep(() => ({ status: 401 })), { deep: { secret: 'nope' } });
    expect(wrong.find((r) => r.name === 'Deep checks')!.detail).toMatch(/CRON_SECRET was refused/);
    const old = await run(withDeep(() => ({ status: 404 })), { deep: { secret: 'x' } });
    expect(old.find((r) => r.name === 'Deep checks')!.detail).toMatch(/no deep check yet/);
  });
});
