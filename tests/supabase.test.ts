process.env.PGLITE_DIR = 'memory';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  databaseUrl, sessionModeUrl, dbSsl, dbHost, dbUser, poolSettings, rlsWanted, usingSupabase, envProblems, dbHint, isPoolFull,
  maintenanceOn, staysOpenInMaintenance, maintenancePage, isSupabaseHost, isSupabasePooler, isSupabaseDirect,
} from '../lib/envcheck';
import { lockDownTables, openTables, tableCount } from '../lib/rls';
import { retryWhenPoolFull, query as appQuery } from '../lib/db';
import { setupChecks } from '../lib/setup';
import { middleware } from '../middleware';

const env = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;
const POOLER = 'postgresql://postgres.abcdefghijklmnop:Secret123@aws-0-eu-central-1.pooler.supabase.com:5432/postgres';
const POOLER_6543 = POOLER.replace(':5432', ':6543');
const DIRECT = 'postgresql://postgres:Secret123@db.abcdefghijklmnop.supabase.co:5432/postgres';
const LIVE = { NODE_ENV: 'production', DEMO_MODE: 'false', SESSION_SECRET: 'x'.repeat(40) };

afterEach(() => vi.unstubAllEnvs());

describe('recognising Supabase addresses', () => {
  it('tells the pooler, the direct address and other hosts apart', () => {
    expect(isSupabasePooler(dbHost(POOLER))).toBe(true);
    expect(isSupabaseDirect(dbHost(POOLER))).toBe(false);
    expect(isSupabaseDirect(dbHost(DIRECT))).toBe(true);
    expect(isSupabaseHost(dbHost(DIRECT))).toBe(true);
    expect(isSupabaseHost('dpg-abc123-a.frankfurt-postgres.render.com')).toBe(false);
    expect(isSupabaseHost('localhost')).toBe(false);
    expect(usingSupabase(env({ DATABASE_URL: POOLER }))).toBe(true);
    expect(usingSupabase(env({ DATABASE_URL: 'postgres://u:p@localhost/db' }))).toBe(false);
  });
  it('reads the user name without the password', () => {
    expect(dbUser(POOLER)).toBe('postgres.abcdefghijklmnop');
    expect(dbUser(DIRECT)).toBe('postgres');
    expect(dbUser('')).toBe('');
  });
});

describe('the address is cleaned and always runs in session mode', () => {
  it('switches the pooler port 6543 (transaction mode) to 5432 (session mode), and nothing else', () => {
    expect(sessionModeUrl(POOLER_6543)).toBe(POOLER);
    expect(sessionModeUrl(`${POOLER_6543}?sslmode=require`)).toBe(`${POOLER}?sslmode=require`);
    expect(sessionModeUrl(POOLER)).toBe(POOLER);
    expect(sessionModeUrl('postgres://u:p@some.other.host.com:6543/db')).toBe('postgres://u:p@some.other.host.com:6543/db');
    expect(sessionModeUrl('postgres://u:p@localhost:6543/db')).toBe('postgres://u:p@localhost:6543/db');
  });
  it('applies it wherever the address comes from, and ignores spaces and quotes from pasting', () => {
    expect(databaseUrl(env({ DATABASE_URL: POOLER_6543 }))).toBe(POOLER);
    expect(databaseUrl(env({ DATABASE_URL: `  ${POOLER}\n` }))).toBe(POOLER);
    expect(databaseUrl(env({ DATABASE_URL: `"${POOLER}"` }))).toBe(POOLER);
    expect(databaseUrl(env({ DATABASE_URL: `'${POOLER_6543}'` }))).toBe(POOLER);
    expect(databaseUrl(env({}))).toBe('');
    expect(databaseUrl(env({ DATABASE_URL_UNPOOLED: POOLER, DATABASE_URL: 'postgres://other/db' }))).toBe(POOLER);
  });
  it('always uses SSL on Supabase, even if a leftover DATABASE_SSL=false is still set from the Render private address', () => {
    expect(dbSsl(env({ DATABASE_URL: POOLER, DATABASE_SSL: 'false' }))).toEqual({ rejectUnauthorized: false });
    expect(dbSsl(env({ DATABASE_URL: DIRECT, DATABASE_SSL: 'false' }))).toEqual({ rejectUnauthorized: false });
    expect(dbSsl(env({ DATABASE_URL: 'postgres://u:p@dpg-abc-a/db', DATABASE_SSL: 'false' }))).toBe(false);
    expect(dbSsl(env({ DATABASE_URL: 'postgres://u:p@localhost/db' }))).toEqual({ rejectUnauthorized: false });
  });
});

describe('the connection pool', () => {
  it('stays small on Supabase\'s pooler, and can be set by hand', () => {
    expect(poolSettings(env({ DATABASE_URL: POOLER }))).toEqual({ max: 5, limitViaSet: true });
    expect(poolSettings(env({ DATABASE_URL: POOLER, DATABASE_POOL_MAX: '3' })).max).toBe(3);
    expect(poolSettings(env({ DATABASE_URL: POOLER, DATABASE_POOL_MAX: 'nonsense' })).max).toBe(5);
    expect(poolSettings(env({ DATABASE_URL: POOLER, DATABASE_POOL_MAX: '999' })).max).toBe(50);
  });
  it('is unchanged for every other database', () => {
    expect(poolSettings(env({ DATABASE_URL: 'postgres://u:p@dpg-abc-a/db' }))).toEqual({ max: 10, limitViaSet: false });
    expect(poolSettings(env({ DATABASE_URL: 'postgres://u:p@h.neon.tech/db', VERCEL: '1' }))).toEqual({ max: 2, limitViaSet: false });
    expect(poolSettings(env({ DATABASE_URL: POOLER, VERCEL: '1' }))).toEqual({ max: 2, limitViaSet: true });
  });
});

describe('which databases get their tables locked at start-up', () => {
  it('Supabase does by itself, others only when asked', () => {
    expect(rlsWanted(env({ DATABASE_URL: POOLER }))).toBe(true);
    expect(rlsWanted(env({ DATABASE_URL: DIRECT }))).toBe(true);
    expect(rlsWanted(env({ DATABASE_URL: 'postgres://u:p@dpg-abc-a/db' }))).toBe(false);
    expect(rlsWanted(env({}))).toBe(false);
    expect(rlsWanted(env({ DATABASE_URL: POOLER, DATABASE_RLS: 'off' }))).toBe(false);
    expect(rlsWanted(env({ DATABASE_URL: 'postgres://u:p@dpg-abc-a/db', DATABASE_RLS: 'on' }))).toBe(true);
  });
});

describe('the mistakes that are most likely on a first deploy to Supabase', () => {
  const live = (url: string, more: Record<string, string> = {}) => envProblems(env({ ...LIVE, DATABASE_URL: url, ...more }));
  it('accepts the session pooler address, with or without the transaction-mode port', () => {
    expect(live(POOLER)).toEqual([]);
    expect(live(POOLER, { RENDER: 'true' })).toEqual([]);
    expect(live(POOLER_6543, { RENDER: 'true' })).toEqual([]);
  });
  it('stops, in plain words, when Render is given Supabase\'s direct address (IPv6 only, so it cannot connect)', () => {
    const p = live(DIRECT, { RENDER: 'true' });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/Session pooler/);
    expect(p[0]).not.toMatch(/Secret123/);
    expect(live(DIRECT, { VERCEL: '1' })).toHaveLength(1);
    expect(live(DIRECT)).toEqual([]);   // a server with IPv6, or a laptop, can use it
  });
  it('stops when the pooler is given the plain user name "postgres", which it rejects', () => {
    const p = live('postgresql://postgres:Secret123@aws-0-eu-central-1.pooler.supabase.com:5432/postgres');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/postgres\.<?|postgres\. followed by your project reference/);
  });
  it('stops when the password placeholder was left in', () => {
    const p = live('postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/YOUR-PASSWORD/);
  });
});

describe('the advice a failed connection gives', () => {
  const sb = env({ DATABASE_URL: POOLER, RENDER: 'true' });
  const sbDirect = env({ DATABASE_URL: DIRECT, RENDER: 'true' });
  it('explains an unknown project or user, and a paused project', () => {
    const h = dbHint(new Error('Tenant or user not found'), sb)!;
    expect(h).toMatch(/postgres\./);
    expect(h).toMatch(/Resume project/);
  });
  it('explains a full pool, only for Supabase, and leaves the old advice for other hosts', () => {
    expect(dbHint(new Error('max clients reached in session mode - max clients are limited to pool_size: 15'), sb)).toMatch(/DATABASE_POOL_MAX/);
    expect(dbHint(Object.assign(new Error('remaining connection slots are reserved'), { code: '53300' }), env({ DATABASE_URL: 'postgres://u:p@dpg-abc-a/db' }))).toMatch(/no free connections/);
  });
  it('explains the direct address that Render cannot reach, whichever way the failure shows', () => {
    for (const e of [Object.assign(new Error('getaddrinfo ENOTFOUND db.abcdefghijklmnop.supabase.co'), { code: 'ENOTFOUND' }), Object.assign(new Error('connect ENETUNREACH 2a05:d014::1:5432'), { code: 'ENETUNREACH' }), Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })]) {
      expect(dbHint(e, sbDirect)).toMatch(/Session pooler/);
    }
  });
  it('explains a wrong password in Supabase terms (brackets, reset), and a timeout or refusal with the paused-project case', () => {
    expect(dbHint(Object.assign(new Error('password authentication failed for user "postgres.abc"'), { code: '28P01' }), sb)).toMatch(/square brackets/);
    expect(dbHint(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }), sb)).toMatch(/Resume project/);
    expect(dbHint(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), sb)).toMatch(/5432/);
    expect(dbHint(Object.assign(new Error('getaddrinfo ENOTFOUND aws-0-eu-central-1.pooler.supabase.com'), { code: 'ENOTFOUND' }), sb)).toMatch(/Resume project/);
  });
  it('keeps the advice for Render and others exactly as it was', () => {
    expect(dbHint(Object.assign(new Error('password authentication failed'), { code: '28P01' }), env({ DATABASE_URL: 'postgres://u:p@dpg-abc-a/db' }))).toMatch(/Copy the address again from your database provider/);
    expect(dbHint(Object.assign(new Error('getaddrinfo ENOTFOUND dpg-abc123-a'), { code: 'ENOTFOUND', hostname: 'dpg-abc123-a' }), env({})) ).toMatch(/External Database URL/);
  });
});

describe('a busy pooler is asked again, a real error is not', () => {
  const full = () => Object.assign(new Error('max clients reached in session mode'), { code: 'XX000' });
  it('recognises the pooler-full answers', () => {
    expect(isPoolFull(full())).toBe(true);
    expect(isPoolFull(new Error('EMAXCONNSESSION'))).toBe(true);
    expect(isPoolFull(Object.assign(new Error('sorry, too many clients already'), { code: '53300' }))).toBe(true);
    expect(isPoolFull(new Error('syntax error at or near'))).toBe(false);
    expect(isPoolFull(Object.assign(new Error('too many connections for role "postgres.abc"'), { code: '53300' }))).toBe(true);
    expect(isPoolFull(undefined)).toBe(false);
  });
  it('tries again after a moment and succeeds', async () => {
    let calls = 0;
    const out = await retryWhenPoolFull(async () => { if (++calls < 3) throw full(); return 'ok'; }, 1);
    expect(out).toBe('ok');
    expect(calls).toBe(3);
  });
  it('gives up after three more tries, and never retries any other error', async () => {
    let calls = 0;
    await expect(retryWhenPoolFull(async () => { calls++; throw full(); }, 1)).rejects.toThrow(/max clients/);
    expect(calls).toBe(4);
    let other = 0;
    await expect(retryWhenPoolFull(async () => { other++; throw new Error('duplicate key value'); }, 1)).rejects.toThrow(/duplicate/);
    expect(other).toBe(1);
  });
});

describe('closing every table to Supabase\'s public API', () => {
  const adapter = (pg: PGlite) => ({ exec: async (sql: string) => { await pg.exec(sql); }, query: async (sql: string, params?: unknown[]) => (await pg.query(sql, params as any[])).rows as Record<string, any>[] });

  it('locks every open table, leaves locked ones alone, and is safe to run again', async () => {
    const pg = new PGlite();
    await pg.exec('create table a (id int); create table b (id int); create table c (id int); alter table c enable row level security;');
    const q = adapter(pg);
    expect(await openTables(q)).toEqual(['a', 'b']);
    await lockDownTables(q);
    expect(await openTables(q)).toEqual([]);
    await lockDownTables(q);
    expect(await openTables(q)).toEqual([]);
    expect(await tableCount(q)).toBe(3);
    await pg.exec('create table d (id int)');
    expect(await openTables(q)).toEqual(['d']);   // a table a later upgrade adds is open until the next start
    await lockDownTables(q);
    expect(await openTables(q)).toEqual([]);
    await pg.close();
  });

  it('takes the rights away from Supabase\'s public roles, so switching the lock off by hand still opens nothing', async () => {
    const pg = new PGlite();
    await pg.exec(`create role anon nologin; create role authenticated nologin; create schema if not exists public;
      grant usage on schema public to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated;
      create table staff (id int, pin_hash text); insert into staff values (1, 'x');
      grant all on staff to anon, authenticated;`);
    const q = adapter(pg);
    expect((await q.query("select has_table_privilege('anon', 'staff', 'select') as ok"))[0].ok).toBe(true);
    await lockDownTables(q);
    expect((await q.query("select has_table_privilege('anon', 'staff', 'select') as ok"))[0].ok).toBe(false);
    expect((await q.query("select has_table_privilege('authenticated', 'staff', 'select') as ok"))[0].ok).toBe(false);
    await pg.exec('create table later (id int)');   // made after the lock, by the same owner
    expect((await q.query("select has_table_privilege('anon', 'later', 'select') as ok"))[0].ok).toBe(false);
    // The owner (the login Brandit uses) is not affected.
    expect((await q.query('select count(*)::int as n from staff'))[0].n).toBe(1);
    await pg.close();
  });
});

describe('the Setup page on Supabase', () => {
  const SB = { ...LIVE, DATABASE_URL: POOLER, NEXT_PUBLIC_APP_URL: 'https://thebrandit.ng' };
  it('says plainly when tables are open, then when they are locked, and never advises Render\'s internal address', async () => {
    const before = await setupChecks(env(SB));
    const db = before.checks.find((c) => c.id === 'db')!;
    expect(db.detail).toMatch(/Supabase/);
    expect(`${db.detail} ${db.fix ?? ''}`).not.toMatch(/Internal address/);
    const rls = before.checks.find((c) => c.id === 'db-rls')!;
    expect(rls.status).toBe('bad');
    expect(rls.detail).toMatch(/of \d+ tables are open/);
    await lockDownTables({ exec: async (sql) => { await appQuery(sql); }, query: appQuery });
    const after = await setupChecks(env(SB));
    expect(after.checks.find((c) => c.id === 'db-rls')!.status).toBe('ok');
    expect(after.checks.find((c) => c.id === 'db-size')!.status).toBe('ok');
  });
  it('mentions the automatic switch from port 6543', async () => {
    const r = await setupChecks(env({ ...SB, DATABASE_URL: POOLER_6543 }));
    const port = r.checks.find((c) => c.id === 'db-port')!;
    expect(port.status).toBe('info');
    expect(port.detail).toMatch(/5432/);
    expect((await setupChecks(env(SB))).checks.find((c) => c.id === 'db-port')).toBeUndefined();
  });
  it('has no Supabase lines for any other database', async () => {
    const r = await setupChecks(env({ ...LIVE, DATABASE_URL: 'postgres://u:p@dpg-abc-a/db', RENDER: 'true' }));
    expect(r.checks.some((c) => c.id === 'db-rls' || c.id === 'db-size' || c.id === 'db-port')).toBe(false);
  });
});

describe('maintenance mode (used for a few minutes while the database is moved)', () => {
  const live = () => { vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('DEMO_MODE', 'false'); vi.stubEnv('SESSION_SECRET', 'x'.repeat(40)); vi.stubEnv('DATABASE_URL', POOLER); };
  const hit = (path: string, method = 'GET') => middleware(new NextRequest(`https://thebrandit.ng${path}`, { method }));

  it('is on for on, true, yes and 1 only', () => {
    for (const v of ['on', 'ON', 'true', 'yes', '1', ' on ']) expect(maintenanceOn(env({ MAINTENANCE: v }))).toBe(true);
    for (const v of ['', 'off', 'false', '0', 'no', undefined]) expect(maintenanceOn(env({ MAINTENANCE: v }))).toBe(false);
  });
  it('keeps the health check, the scheduled checks, the console and its files open, and closes everything customers use', () => {
    for (const p of ['/api/health', '/api/health/deep', '/api/cron/sweep', '/api/cron/backup', '/console', '/console/login', '/console/orders', '/api/console/x', '/api/files/abc', '/robots.txt']) expect(staysOpenInMaintenance(p), p).toBe(true);
    for (const p of ['/', '/products/business-cards', '/checkout', '/basket', '/api/orders', '/api/webhooks/paystack', '/api/quote', '/account', '/consolex', '/api/healthz']) expect(staysOpenInMaintenance(p), p).toBe(false);
  });
  it('does nothing when it is off', async () => {
    live();
    const res = hit('/');
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
  it('answers customers with a friendly 503 and tells Paystack to try again later', async () => {
    live();
    vi.stubEnv('MAINTENANCE', 'on');
    for (const p of ['/', '/products/business-cards', '/api/orders']) {
      const res = hit(p);
      expect(res.status, p).toBe(503);
      expect(res.headers.get('retry-after')).toBe('120');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toMatch(/Back in a few minutes/);
    }
    const hook = hit('/api/webhooks/paystack', 'POST');
    expect(hook.status).toBe(503);
  });
  it('lets the team, the host\'s health check and the scheduler through', () => {
    live();
    vi.stubEnv('MAINTENANCE', 'on');
    for (const p of ['/console/login', '/console/orders', '/api/health', '/api/cron/sweep']) expect(hit(p).headers.get('x-middleware-next'), p).toBe('1');
  });
  it('shows no address or secret on the page', () => {
    const page = maintenancePage();
    expect(page).not.toMatch(/supabase|postgres|secret|password/i);
  });
  it('a missing setting still shows the set-up page first', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('DEMO_MODE', 'false'); vi.stubEnv('SESSION_SECRET', ''); vi.stubEnv('DATABASE_URL', ''); vi.stubEnv('MAINTENANCE', 'on');
    const res = hit('/console/login');
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/not set up yet/);
  });
});
