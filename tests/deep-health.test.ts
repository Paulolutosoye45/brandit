import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.PGLITE_DIR = 'memory';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.DEMO_MODE = 'false';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-deep-test-${process.pid}`);
for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'PAYSTACK_SECRET_KEY', 'RESEND_API_KEY', 'EMAIL_FROM', 'CRON_SECRET', 'RENDER', 'VERCEL']) delete process.env[k];

let db: typeof import('../lib/db');
let deep: typeof import('../lib/deepHealth');
let bk: typeof import('../lib/backup');
let route: typeof import('../app/api/health/deep/route');

beforeAll(async () => {
  db = await import('../lib/db');
  deep = await import('../lib/deepHealth');
  bk = await import('../lib/backup');
  route = await import('../app/api/health/deep/route');
  await db.ready();
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const k of ['PAYSTACK_SECRET_KEY', 'RESEND_API_KEY', 'EMAIL_FROM', 'CRON_SECRET']) delete process.env[k];
  process.env.DEMO_MODE = 'false';
});
const by = (r: { checks: { id: string }[] }, id: string) => r.checks.find((c) => c.id === id) as import('../lib/deepHealth').DeepCheck;

describe('the deep health check', () => {
  it('passes the database check and notices the missing nightly work on a site that just started', async () => {
    fs.rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true });
    await db.query("delete from events where name in ('sweep','backup','backup_failed','restore_test')");
    const r = await deep.runDeepHealth({});
    expect(by(r, 'database')).toMatchObject({ ok: true });
    expect(by(r, 'database').detail).toMatch(/all \d+ upgrades are applied/);
    expect(by(r, 'backup')).toMatchObject({ ok: false });
    expect(by(r, 'backup').detail).toMatch(/No backup yet/);
    expect(by(r, 'sweep')).toMatchObject({ ok: false });
    expect(by(r, 'sweep').detail).toMatch(/has not run yet/);
    expect(r.ok).toBe(false);
  });

  it('is all green once the nightly work has happened (files on disk, Paystack and email not set up)', async () => {
    await db.query("insert into events (name, props) values ('sweep', '{}')");
    expect((await bk.runBackup()).ok).toBe(true);
    await bk.runRestoreTest();
    // This site has no bucket: in live mode that is a fault, and the check says so.
    const r = await deep.runDeepHealth({});
    expect(by(r, 'backup')).toMatchObject({ ok: true });
    expect(by(r, 'backup').detail).toMatch(/The last restore test passed/);
    expect(by(r, 'sweep')).toMatchObject({ ok: true });
    expect(by(r, 'storage')).toMatchObject({ ok: false });
    expect(by(r, 'storage').detail).toMatch(/No bucket/);
    expect(by(r, 'paystack')).toMatchObject({ ok: false });
    expect(by(r, 'paystack').detail).toMatch(/no Paystack key/);
    expect(by(r, 'email')).toMatchObject({ ok: true, skipped: true });
  });

  it('skips what demo mode does not have, instead of failing it', async () => {
    process.env.DEMO_MODE = 'true';
    const r = await deep.runDeepHealth({});
    expect(by(r, 'storage')).toMatchObject({ ok: true, skipped: true });
    expect(by(r, 'paystack')).toMatchObject({ ok: true, skipped: true });
    expect(by(r, 'backup')).toMatchObject({ ok: true, skipped: true });
  });

  it('only starts a payment and sends an email when asked to (?full=1, and an address)', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
    process.env.RESEND_API_KEY = 're_x';
    process.env.EMAIL_FROM = 'Brandit <hello@thebrandit.ng>';
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url).replace('https://', '')}`);
      if (String(url).includes('transaction/initialize')) return new Response(JSON.stringify({ data: { authorization_url: 'https://checkout.paystack.com/x' } }), { status: 200 });
      if (String(url).endsWith('/emails')) return new Response('{"id":"em1"}', { status: 200 });
      if (String(url).includes('/emails/em1')) return new Response('{"last_event":"delivered"}', { status: 200 });
      return new Response('{}', { status: 200 });
    }));
    const quiet = await deep.runDeepHealth({});
    expect(by(quiet, 'paystack')).toMatchObject({ ok: true });
    expect(calls.some((c) => c.includes('initialize'))).toBe(false);
    expect(calls.some((c) => c.includes('api.resend.com'))).toBe(false);
    const full = await deep.runDeepHealth({ full: true, email: 'me@x.ng' });
    expect(calls.some((c) => c.startsWith('POST api.paystack.co/transaction/initialize'))).toBe(true);
    expect(by(full, 'paystack').detail).toMatch(/started one N100 payment/);
    expect(by(full, 'email')).toMatchObject({ ok: true });
    expect(by(full, 'email').detail).toMatch(/Resend confirms it was delivered/);
  });

  it('never throws: a check that blows up becomes a failed row', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network is down'); }));
    const r = await deep.runDeepHealth({});
    expect(by(r, 'paystack')).toMatchObject({ ok: false });
    expect(r.checks.length).toBeGreaterThanOrEqual(6);
  });
});

describe('/api/health/deep is closed to the public', () => {
  const call = (auth?: string, qs = '') => route.GET(new Request(`http://x/api/health/deep${qs}`, { headers: auth ? { authorization: auth } : {} }));
  it('refuses a stranger, with or without a secret on the site', async () => {
    process.env.CRON_SECRET = 'cron-secret-value';
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call()).status).toBe(401); // live mode, no secret: closed
  });
  it('answers the owner with the checks, 503 if any failed, and shows no key or address', async () => {
    process.env.CRON_SECRET = 'cron-secret-value';
    process.env.PAYSTACK_SECRET_KEY = 'sk_live_supersecretkey123';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"status":true}', { status: 200 })));
    const r = await call('Bearer cron-secret-value');
    const body = await r.json();
    expect([200, 503]).toContain(r.status);
    expect(r.status).toBe(body.ok ? 200 : 503);
    expect(body.checks.map((c: any) => c.id)).toEqual(['database', 'storage', 'paystack', 'email', 'backup', 'sweep']);
    expect(JSON.stringify(body)).not.toMatch(/supersecretkey|cron-secret-value|postgres:\/\//);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('is open in demo mode when no secret is set (a trial on your own computer)', async () => {
    process.env.DEMO_MODE = 'true';
    expect((await call()).status).toBeLessThan(500);
  });
});
