import { MIGRATIONS } from './schema';
import { isDemoEnv, databaseUrl, dbSsl } from './envcheck';

export type Row = Record<string, any>;
export interface Q {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}
interface Driver extends Q {
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  /** Run fn only if nobody else (another server) is already running work under this key. */
  lock<T>(key: number, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }>;
}

/**
 * A hosted database restarts now and then (maintenance, a network blip). An idle connection then reports an error,
 * and Node ends the whole process if nothing is listening for it. Listen, log it, and let the pool reconnect.
 */
export function attachPoolGuards(pool: { on(event: 'error', fn: (e: Error) => void): unknown }) {
  pool.on('error', (e) => console.error(`[brandit] database connection error (it will reconnect): ${e.message}`));
}

const g = globalThis as unknown as { __brandit_db?: Promise<Driver> };

/** Demo mode: see lib/envcheck.ts. On by default only while developing; in production it must be asked for. */
export const isDemo = (env: NodeJS.ProcessEnv = process.env) => isDemoEnv(env);

/** Refuse a combination that would put demo logins on a real database. */
export function assertSafeMode(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === 'production' && env.DEMO_MODE === 'true' && databaseUrl(env)) {
    throw new Error('DEMO_MODE=true cannot be used with a hosted database (DATABASE_URL) in production. Set DEMO_MODE=false.');
  }
}

async function open(): Promise<Driver> {
  assertSafeMode();
  const url = databaseUrl(process.env);
  if (url) {
    const { Pool } = await import('pg');
    const ssl = dbSsl(process.env);
    // Vercel starts many short-lived copies of the server, and each keeps its own pool, so keep each one small.
    const max = Math.max(1, Math.min(50, Math.floor(Number(process.env.DATABASE_POOL_MAX)) || (process.env.VERCEL ? 4 : 10)));
    const pool = new Pool({ connectionString: url, ssl, max, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000, keepAlive: true, statement_timeout: 30_000 });
    attachPoolGuards(pool);
    return {
      query: async <T extends Row = Row>(sql: string, params?: unknown[]) => (await pool.query(sql, params as any[])).rows as T[],
      exec: async (sql) => {
        await pool.query(sql);
      },
      tx: async (fn) => {
        const c = await pool.connect();
        let broken = false;
        try {
          await c.query('begin');
          const out = await fn({ query: async <T extends Row = Row>(sql: string, params?: unknown[]) => (await c.query(sql, params as any[])).rows as T[] });
          await c.query('commit');
          return out;
        } catch (e) {
          try { await c.query('rollback'); } catch { broken = true; } // a dead connection must not go back in the pool
          throw e;
        } finally {
          c.release(broken ? true : undefined);
        }
      },
      lock: async (key, fn) => {
        const c = await pool.connect();
        let got = false;
        try {
          got = (await c.query('select pg_try_advisory_lock($1) as ok', [key])).rows[0]?.ok === true;
          if (!got) return { ran: false as const };
          return { ran: true as const, value: await fn() };
        } finally {
          if (got) await c.query('select pg_advisory_unlock($1)', [key]).catch(() => {});
          c.release();
        }
      },
    };
  }
  // Built-in local Postgres (PGlite): the real Postgres engine, no install needed.
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR ?? '.data/pg';
  if (dir !== 'memory') {
    const fs = await import('node:fs');
    fs.mkdirSync(dir, { recursive: true });
  }
  const pg = dir === 'memory' ? new PGlite() : new PGlite(dir);
  await pg.waitReady;
  return {
    query: async <T extends Row = Row>(sql: string, params?: unknown[]) => (await pg.query(sql, params as any[])).rows as T[],
    exec: async (sql) => {
      await pg.exec(sql);
    },
    tx: async (fn) =>
      pg.transaction(async (t) => fn({ query: async <T extends Row = Row>(sql: string, params?: unknown[]) => (await t.query(sql, params as any[])).rows as T[] })),
    // One process owns this database, so a lock inside the process is enough.
    lock: async (key, fn) => {
      const held = ((globalThis as any).__brandit_locks ??= new Set<number>()) as Set<number>;
      if (held.has(key)) return { ran: false as const };
      held.add(key);
      try { return { ran: true as const, value: await fn() }; } finally { held.delete(key); }
    },
  };
}

async function boot(): Promise<Driver> {
  const d = await open();
  await d.exec('create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await d.query<{ id: string }>('select id from schema_migrations')).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await d.exec(m.sql);
    await d.query('insert into schema_migrations (id) values ($1)', [m.id]);
    if (m.after) await m.after(d);
  }
  const { seedIfEmpty } = await import('./seed');
  await seedIfEmpty(d);
  if (!isDemo()) {
    const { ensureAdmin } = await import('./team');
    const r = await ensureAdmin(process.env, d);
    if (r === 'weak-pin') console.error('[brandit] ADMIN_PIN is too easy or the wrong length (6 to 12 digits, not a run like 123456). No admin was created.');
    if (r === 'created') console.log('[brandit] First admin created from ADMIN_EMAIL. Sign in at /console/login and change the PIN.');
  }
  return d;
}

function driver(): Promise<Driver> {
  if (!g.__brandit_db) {
    // A failed start must not be remembered: the next request tries again, so a database that was briefly down does not
    // leave this copy of the server broken until it is replaced.
    const p = boot();
    g.__brandit_db = p;
    p.catch(() => { if (g.__brandit_db === p) g.__brandit_db = undefined; });
  }
  return g.__brandit_db;
}

export async function query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await driver()).query<T>(sql, params);
}
export async function one<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
export async function tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  return (await driver()).tx(fn);
}
export async function withLock<T>(key: number, fn: () => Promise<T>) {
  return (await driver()).lock(key, fn);
}
/** Test helper: wait for migrations and seed. */
export async function ready() {
  await driver();
}
export async function resetForTests() {
  g.__brandit_db = undefined;
}
