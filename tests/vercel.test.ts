import { describe, it, expect, afterEach, vi } from 'vitest';
import { envProblems, dbHint, setupPage, isDemoEnv, databaseUrl, dbSsl, dbHost } from '../lib/envcheck';
import { fatalProblems } from '../lib/setup';
import { applyHostLimits, VERCEL_UPLOAD_MB } from '../lib/settings';
import { DEFAULT_SETTINGS } from '../lib/settings-defaults';
import { middleware, config } from '../middleware';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const LIVE = { NODE_ENV: 'production', DEMO_MODE: 'false', SESSION_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@h.example.com/db' };

afterEach(() => vi.unstubAllEnvs());

describe('what a live site cannot start without', () => {
  it('is happy with a complete live setup, on Vercel or anywhere else', () => {
    expect(envProblems(env(LIVE))).toEqual([]);
    expect(envProblems(env({ ...LIVE, VERCEL: '1' }))).toEqual([]);
  });
  it('names each missing setting and never shows a value', () => {
    const p = envProblems(env({ NODE_ENV: 'production', VERCEL: '1' }));
    expect(p.join(' ')).toMatch(/SESSION_SECRET/);
    expect(p.join(' ')).toMatch(/DATABASE_URL/);
    const withSecrets = envProblems(env({ NODE_ENV: 'production', SESSION_SECRET: 'short', DATABASE_URL: '' }));
    expect(withSecrets.join(' ')).not.toMatch(/short/);
  });
  it('refuses demo mode next to a hosted database in production (the likely first-deploy mistake)', () => {
    const p = envProblems(env({ ...LIVE, DEMO_MODE: 'true' }));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/DEMO_MODE is true while DATABASE_URL is set/);
  });
  it('does not complain about demo mode on a laptop', () => {
    expect(envProblems(env({ NODE_ENV: 'development', DEMO_MODE: 'true' }))).toEqual([]);
    expect(envProblems(env({ NODE_ENV: 'development', DEMO_MODE: 'true', DATABASE_URL: 'postgres://x' }))).toEqual([]);
  });
  it('says the built-in database cannot run on Vercel, even in demo mode', () => {
    const p = envProblems(env({ NODE_ENV: 'production', DEMO_MODE: 'true', VERCEL: '1' }));
    expect(p.join(' ')).toMatch(/no disk that keeps files/);
  });
  it('is the same rule the server start-up uses', () => {
    expect(fatalProblems(env({ NODE_ENV: 'production' }))).toEqual(envProblems(env({ NODE_ENV: 'production' })));
    expect(isDemoEnv(env({ NODE_ENV: 'production' }))).toBe(false);
  });
});

describe('which database address and SSL are used', () => {
  const INTERNAL = 'postgresql://brandit_user:secret@dpg-db4ikr7avr4c73fcnai0-a/brandit';
  const EXTERNAL = 'postgresql://brandit_user:secret@dpg-db4ikr7avr4c73fcnai0-a.frankfurt-postgres.render.com/brandit';
  it('stops a Render Internal URL before it can time out, anywhere but inside Render', () => {
    const p = envProblems(env({ ...LIVE, VERCEL: '1', DATABASE_URL: INTERNAL }));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/Internal Database URL/);
    expect(p[0]).toMatch(/External/);
    expect(p[0]).not.toMatch(/secret/);
    expect(envProblems(env({ ...LIVE, RENDER: 'true', DATABASE_URL: INTERNAL }))).toEqual([]);
    expect(envProblems(env({ ...LIVE, VERCEL: '1', DATABASE_URL: EXTERNAL }))).toEqual([]);
  });
  it('always uses SSL for Render\'s external address, even when DATABASE_SSL says false', () => {
    expect(dbSsl(env({ DATABASE_URL: EXTERNAL, DATABASE_SSL: 'false' }))).toEqual({ rejectUnauthorized: false });
    expect(dbSsl(env({ DATABASE_URL: 'postgres://u:p@localhost:5432/db', DATABASE_SSL: 'false' }))).toBe(false);
    expect(dbSsl(env({ DATABASE_URL: 'postgres://u:p@db.example.com/db' }))).toEqual({ rejectUnauthorized: false });
  });
  it('prefers the direct address that Vercel\'s Neon integration sets beside the pooled one', () => {
    expect(databaseUrl(env({ DATABASE_URL: 'postgres://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db', DATABASE_URL_UNPOOLED: 'postgres://u:p@ep-x.eu-central-1.aws.neon.tech/db' }))).toMatch(/ep-x\.eu-central/);
    expect(databaseUrl(env({ DATABASE_URL: EXTERNAL }))).toBe(EXTERNAL);
    expect(envProblems(env({ NODE_ENV: 'production', DEMO_MODE: 'false', SESSION_SECRET: 'x'.repeat(40), DATABASE_URL_UNPOOLED: EXTERNAL }))).toEqual([]);
  });
  it('reads the host without ever returning the password', () => {
    expect(dbHost(EXTERNAL)).toBe('dpg-db4ikr7avr4c73fcnai0-a.frankfurt-postgres.render.com');
    expect(dbHost(INTERNAL)).toBe('dpg-db4ikr7avr4c73fcnai0-a');
    expect(dbHost('postgres://u:p@ss#word@host.example.com/db')).not.toMatch(/word/);
    expect(dbHost('')).toBe('');
  });
});

describe('plain-words help for a database that will not open', () => {
  it('spots Render\'s Internal Database URL', () => {
    const h = dbHint(Object.assign(new Error('getaddrinfo ENOTFOUND dpg-abc123def456-a'), { code: 'ENOTFOUND', hostname: 'dpg-abc123def456-a' }));
    expect(h).toMatch(/Internal Database URL/);
    expect(h).toMatch(/\.render\.com/);
  });
  it('reads the host out of the message when the error has no hostname field', () => {
    expect(dbHint(new Error('getaddrinfo ENOTFOUND dpg-zz99-a'))).toMatch(/Internal Database URL/);
  });
  it('gives different advice for an ordinary missing host', () => {
    const h = dbHint(Object.assign(new Error('getaddrinfo ENOTFOUND db.example.com'), { code: 'ENOTFOUND', hostname: 'db.example.com' }));
    expect(h).toMatch(/typo/);
    expect(h).not.toMatch(/Internal/);
  });
  it('covers wrong password, missing database, SSL and too many connections', () => {
    expect(dbHint(Object.assign(new Error('password authentication failed for user "x"'), { code: '28P01' }))).toMatch(/user name or password/);
    expect(dbHint(Object.assign(new Error('database "nope" does not exist'), { code: '3D000' }))).toMatch(/name at the end/);
    expect(dbHint(new Error('The server does not support SSL connections'))).toMatch(/DATABASE_SSL to false/);
    expect(dbHint(new Error('self-signed certificate in certificate chain'))).toMatch(/DATABASE_SSL/);
    expect(dbHint(Object.assign(new Error('sorry, too many clients already'), { code: '53300' }))).toMatch(/DATABASE_POOL_MAX/);
  });
  it('mentions the anywhere-access setting for timeouts and refusals on Vercel only', () => {
    const t = new Error('Connection terminated due to connection timeout');
    expect(dbHint(t, env({ VERCEL: '1' }))).toMatch(/0\.0\.0\.0\/0/);
    expect(dbHint(t, env({}))).not.toMatch(/0\.0\.0\.0\/0/);
    expect(dbHint(Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' }), env({ VERCEL: '1' }))).toMatch(/0\.0\.0\.0\/0/);
  });
  it('says nothing when it has nothing useful to say', () => {
    expect(dbHint(new Error('something else'))).toBeUndefined();
    expect(dbHint(undefined)).toBeUndefined();
  });
});

describe('the "not set up yet" page', () => {
  it('lists the problems, escapes them, and points Vercel owners at Environment Variables and a redeploy', () => {
    const html = setupPage(['A <b>problem</b> & more'], env({ VERCEL: '1' }));
    expect(html).toContain('Brandit is not set up yet');
    expect(html).toContain('A &lt;b&gt;problem&lt;/b&gt; &amp; more');
    expect(html).toMatch(/Environment Variables/);
    expect(html).toMatch(/redeploy/);
    expect(html).toContain('noindex');
  });
  it('does not mention Vercel to people on other hosts', () => {
    expect(setupPage(['x'], env({}))).not.toMatch(/Vercel/);
  });
});

describe('the middleware', () => {
  it('lets everything through on a site that is set up', () => {
    for (const [k, v] of Object.entries(LIVE)) vi.stubEnv(k, v);
    const r = middleware();
    expect(r.status).toBe(200);
    expect(r.headers.get('x-middleware-next')).toBe('1');
  });
  it('answers 503 with the page, never a bare 500, when settings are missing', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('DEMO_MODE', 'false'); vi.stubEnv('SESSION_SECRET', ''); vi.stubEnv('DATABASE_URL', ''); vi.stubEnv('VERCEL', '1');
    const r = middleware();
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('60');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-robots-tag')).toBe('noindex');
    const body = await r.text();
    expect(body).toContain('SESSION_SECRET');
    expect(body).toContain('DATABASE_URL');
  });
  it('skips only the files Next serves by itself', () => {
    expect(config.matcher).toEqual(['/((?!_next/static|_next/image).*)']);
  });
});

describe('Vercel upload cap', () => {
  it('lowers the limit to what Vercel accepts, only on Vercel', () => {
    expect(DEFAULT_SETTINGS.max_upload_mb).toBeGreaterThan(VERCEL_UPLOAD_MB);
    expect(applyHostLimits(DEFAULT_SETTINGS, env({ VERCEL: '1' })).max_upload_mb).toBe(VERCEL_UPLOAD_MB);
    expect(applyHostLimits(DEFAULT_SETTINGS, env({})).max_upload_mb).toBe(DEFAULT_SETTINGS.max_upload_mb);
  });
  it('never raises a limit that is already lower', () => {
    expect(applyHostLimits({ ...DEFAULT_SETTINGS, max_upload_mb: 2 }, env({ VERCEL: '1' })).max_upload_mb).toBe(2);
  });
  it('stays under what Vercel refuses (about 4.5 MB)', () => {
    expect(VERCEL_UPLOAD_MB).toBeLessThan(4.5);
  });
});
