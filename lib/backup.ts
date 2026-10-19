/*
 * Our own copy of the database, independent of the host.
 *
 * Every night (about 2am Lagos time) the whole database is written to the file bucket as one compressed file, read back
 * to prove it is whole, and old copies are tidied away (14 daily, 12 monthly). Once a month the newest copy is restored
 * into a scratch database and checked row by row, because a backup nobody has ever restored is only a hope.
 *
 * The file is plain JSON: one list of rows per table, plus the order-number counters. That keeps it readable years from now
 * and lets the same file be restored into any Postgres with `npm run restore`.
 *
 * It holds customer details, so the bucket must stay private (no public address). It never goes through the website.
 */
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { isDemo, one, query, tx, withLock } from './db';
import { MIGRATIONS } from './schema';
import { BACKUP_NAME, deleteNamed, getNamed, listNamed, putNamed, s3On, type StoredFile } from './storage';
import { siteAlert } from './siteAlert';

export const BACKUP_FORMAT = 'brandit-backup-1';
export const BACKUP_LOCK = 727002;
export const KEEP_DAILY = 14;
export const KEEP_MONTHLY = 12;
const DAY = 86_400_000;

export type Backup = {
  format: typeof BACKUP_FORMAT;
  createdAt: string;
  build?: string;
  /** The schema versions the data belongs to, so a restore builds the same tables. */
  migrations: string[];
  counts: Record<string, number>;
  /** Counters that must carry on from where they were, such as the order number. */
  sequences: Record<string, string>;
  tables: Record<string, Record<string, unknown>[]>;
};

/** Anything that can run SQL: the live database, a scratch one, or a connection to a new server. */
export interface Target {
  query(sql: string, params?: unknown[]): Promise<Record<string, any>[]>;
  exec(sql: string): Promise<void>;
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/* ------------------------------------------------------------------ names and times */

/** Lagos is UTC+1 all year, with no clock change. */
export function lagosParts(d: Date): { date: string; month: string; hour: number } {
  const l = new Date(d.getTime() + 3_600_000);
  const iso = l.toISOString();
  return { date: iso.slice(0, 10), month: iso.slice(0, 7), hour: l.getUTCHours() };
}
export const dailyName = (d: Date) => `backups/daily/${lagosParts(d).date}.json.gz`;
export const monthlyName = (d: Date) => `backups/monthly/${lagosParts(d).month}.json.gz`;

/** Is tonight's backup due? Once a day after 2am Lagos time, or at once if there has never been one; after a failure wait 30 minutes. */
export function backupDue(now: Date, lastOk: Date | null, lastFail: Date | null): boolean {
  if (lastFail && now.getTime() - lastFail.getTime() < 30 * 60_000 && (!lastOk || lastFail > lastOk)) return false;
  if (!lastOk) return true;
  if (now.getTime() - lastOk.getTime() > 30 * 3_600_000) return true;
  const n = lagosParts(now);
  return lagosParts(lastOk).date < n.date && n.hour >= 2;
}

/** Is the monthly restore test due? Every 30 days; after a failed attempt try again the next day. */
export function restoreTestDue(now: Date, lastOk: Date | null, lastTry: Date | null): boolean {
  if (lastOk && now.getTime() - lastOk.getTime() < 30 * DAY) return false;
  if (lastTry && now.getTime() - lastTry.getTime() < DAY) return false;
  return true;
}

/** Backups are skipped in demo mode, and on hosts with no lasting disk when no bucket is set (the copy would vanish at the next deploy). */
export function backupsEnabled(env: NodeJS.ProcessEnv = process.env): { on: boolean; why?: string } {
  if (env.BACKUPS === 'off') return { on: false, why: 'BACKUPS=off' };
  if (env.BACKUPS !== 'on' && isDemo(env)) return { on: false, why: 'demo mode' };
  if (!s3On() && (env.RENDER || env.VERCEL)) return { on: false, why: 'no file bucket is set, and this host has no disk that lasts' };
  return { on: true };
}

/* ------------------------------------------------------------------ making a backup */

const rowsOf = (v: unknown): Record<string, unknown>[] => (typeof v === 'string' ? JSON.parse(v) : (v as Record<string, unknown>[])) ?? [];

/** Read every table as one consistent snapshot. */
export async function dumpDatabase(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<Backup> {
  return tx(async (q) => {
    await q.query('set transaction isolation level repeatable read');
    const names = (await q.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")).map((r) => r.table_name);
    const tables: Backup['tables'] = {};
    const counts: Backup['counts'] = {};
    for (const n of names) {
      const r = await q.query<{ j: unknown }>(`select coalesce(json_agg(t), '[]'::json)::text as j from ${quote(n)} t`);
      tables[n] = rowsOf(r[0]?.j);
      counts[n] = tables[n].length;
    }
    const seq = await q.query<{ name: string; v: string }>("select sequencename as name, last_value::text as v from pg_sequences where schemaname = 'public' and last_value is not null");
    const sequences: Backup['sequences'] = {};
    for (const s of seq) sequences[s.name] = s.v;
    const migrations = (await q.query<{ id: string }>('select id from schema_migrations order by id')).map((r) => r.id);
    return { format: BACKUP_FORMAT, createdAt: now.toISOString(), build: (env.RENDER_GIT_COMMIT || env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || undefined, migrations, counts, sequences, tables };
  });
}

export const encodeBackup = (b: Backup): Buffer => gzipSync(Buffer.from(JSON.stringify(b)), { level: 6 });

export function decodeBackup(buf: Buffer): Backup {
  let b: Backup;
  try { b = JSON.parse(gunzipSync(buf).toString('utf8')); } catch { throw new Error('This is not a Brandit backup file (it could not be unpacked).'); }
  if (b?.format !== BACKUP_FORMAT || !b.tables || typeof b.tables !== 'object') throw new Error('This is not a Brandit backup file (wrong format).');
  for (const [t, rows] of Object.entries(b.tables)) {
    if (!Array.isArray(rows) || rows.length !== b.counts?.[t]) throw new Error(`The backup is damaged: table ${t} does not have the number of rows it should.`);
  }
  return b;
}

export const totalRows = (b: Backup) => Object.values(b.counts).reduce((a, n) => a + n, 0);

export type BackupOutcome =
  | { ok: true; name: string; bytes: number; rows: number; tables: number; ms: number; monthly?: string; removed: string[] }
  | { ok: false; error: string };

async function tidy(prefix: 'backups/daily/' | 'backups/monthly/', keep: number, protect: string): Promise<string[]> {
  const all = await listNamed(prefix);
  const gone: string[] = [];
  for (const f of all.slice(keep)) {
    if (f.name === protect) continue;
    try { await deleteNamed(f.name); gone.push(f.name); } catch { /* try again tomorrow */ }
  }
  return gone;
}

/** Take a backup now: dump, store, read back and compare, record, tidy. On any failure tell the owner and say so in the result. */
export async function runBackup(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<BackupOutcome> {
  const t0 = Date.now();
  try {
    const b = await dumpDatabase(now, env);
    const gz = encodeBackup(b);
    const name = dailyName(now);
    await putNamed(name, gz);
    // Prove it: read the stored copy back, unpack it and compare it with what was sent.
    const back = await getNamed(name);
    if (back.length !== gz.length || sha(back) !== sha(gz)) throw new Error('the copy in storage is not the same as the one that was sent');
    const check = decodeBackup(back);
    if (totalRows(check) !== totalRows(b)) throw new Error('the stored copy has a different number of rows');
    let monthly: string | undefined;
    const mName = monthlyName(now);
    if (!(await listNamed('backups/monthly/')).some((f) => f.name === mName)) { await putNamed(mName, gz); monthly = mName; }
    const removed = [...(await tidy('backups/daily/', KEEP_DAILY, name)), ...(await tidy('backups/monthly/', KEEP_MONTHLY, mName))];
    const out = { ok: true as const, name, bytes: gz.length, rows: totalRows(b), tables: Object.keys(b.tables).length, ms: Date.now() - t0, monthly, removed };
    await query("insert into events (name, props) values ('backup', $1)", [JSON.stringify({ name, bytes: out.bytes, rows: out.rows, tables: out.tables, ms: out.ms, monthly: !!monthly })]).catch(() => {});
    return out;
  } catch (e) {
    const error = (e as Error)?.message ?? String(e);
    await query("insert into events (name, props) values ('backup_failed', $1)", [JSON.stringify({ error: error.slice(0, 300) })]).catch(() => {});
    await siteAlert({ key: 'backup', what: `The nightly backup failed (${error.slice(0, 160)}). Until it works there is no fresh copy of the orders and customers. Open the console, Setup page, and press Back up now.`, error: e, repeatMinutes: 360 }, env);
    return { ok: false, error };
  }
}

/* ------------------------------------------------------------------ restoring a backup */

/** Create the tables a backup belongs to, in an empty database. Only the table definitions: the data comes from the backup. */
export async function createSchema(t: Target, b: Backup): Promise<void> {
  const known = new Set(MIGRATIONS.map((m) => m.id));
  const unknown = b.migrations.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`This backup is from a newer version of Brandit (it has ${unknown[0]}). Update the site's code first, then restore.`);
  await t.exec('create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())');
  for (const m of MIGRATIONS) if (b.migrations.includes(m.id)) await t.exec(m.sql);
}

export type RestoreReport = { tables: number; rows: number; problems: string[] };

/**
 * Put a backup's data into a database that already has the tables. Everything in those tables is replaced.
 *
 * Some tables point at each other (an order and its custom request, an order and its Studio design), so there is no order
 * that loads them one by one without breaking a rule. So the links between tables are taken off, the rows are loaded, and
 * the links are put back, which checks every one of them. All of it happens in one transaction: if anything is wrong,
 * nothing changes. `t` must be a single connection.
 */
export async function restoreBackup(t: Target, b: Backup): Promise<RestoreReport> {
  const have = new Set((await t.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")).map((r) => r.table_name as string));
  const names = Object.keys(b.tables).sort();
  const missing = names.filter((n) => !have.has(n));
  if (missing.length) throw new Error(`The database has no table ${missing[0]}. Create the tables first (or use a database with an older version of the site).`);

  await t.exec('begin');
  try {
    const links = await t.query("select c.relname as tbl, k.conname as name, pg_get_constraintdef(k.oid) as def from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace where k.contype = 'f' and n.nspname = 'public' order by 1, 2");
    for (const l of links) await t.exec(`alter table ${quote(l.tbl)} drop constraint ${quote(l.name)}`);
    await t.exec(`truncate table ${names.map(quote).join(', ')} restart identity`);

    for (const n of names) {
      const rows = b.tables[n];
      if (!rows.length) continue;
      const cols = (await t.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER' order by ordinal_position", [n])).map((r) => r.column_name as string);
      // Only columns the backup has: a column added to the site after the backup keeps its default.
      const inBackup = new Set(Object.keys(rows[0]));
      const list = cols.filter((c) => inBackup.has(c)).map(quote).join(', ');
      for (let i = 0; i < rows.length; i += 2000) {
        await t.query(`insert into ${quote(n)} (${list}) overriding system value select ${list} from json_populate_recordset(null::${quote(n)}, $1::json)`, [JSON.stringify(rows.slice(i, i + 2000))]);
      }
    }

    // Putting the links back checks that every row still finds the row it points at.
    for (const l of links) {
      try { await t.exec(`alter table ${quote(l.tbl)} add constraint ${quote(l.name)} ${l.def}`); }
      catch (e) { throw new Error(`The saved rows break a rule (${l.tbl}: ${l.def}): ${(e as Error).message}`); }
    }

    // Counters carry on from where they were, so the next order number is never one that was already used.
    for (const [seq, last] of Object.entries(b.sequences ?? {})) {
      await t.query('select setval($1::regclass, $2::bigint, true)', [quote(seq), last]).catch(() => {});
    }

    const problems: string[] = [];
    for (const n of names) {
      const got = Number((await t.query(`select count(*)::int as n from ${quote(n)}`))[0].n);
      if (got !== b.counts[n]) problems.push(`${n}: ${got} rows came back, ${b.counts[n]} were saved`);
    }
    // Money must come back to the kobo, and the order counter must not have gone backwards.
    const sum = (rows: Record<string, unknown>[], col: string) => rows.reduce((a, r) => a + Number(r[col] ?? 0), 0);
    for (const [table, col] of [['orders', 'total_kobo'], ['payments', 'amount_kobo']] as const) {
      if (!b.tables[table]?.length) continue;
      const got = Number((await t.query(`select coalesce(sum(${quote(col)}), 0)::bigint::text as s from ${quote(table)}`))[0].s);
      if (got !== sum(b.tables[table], col)) problems.push(`${table}: the money does not add up (${got} against ${sum(b.tables[table], col)})`);
    }
    if (b.sequences?.order_seq) {
      const next = Number((await t.query('select last_value::text as v from order_seq'))[0].v);
      if (next < Number(b.sequences.order_seq)) problems.push('the order number counter went backwards');
    }
    if (problems.length) throw new Error(`The restore did not match the backup, so nothing was changed: ${problems.slice(0, 3).join('; ')}`);
    await t.exec('commit');
    return { tables: names.length, rows: totalRows(b), problems };
  } catch (e) {
    await t.exec('rollback').catch(() => {});
    throw e;
  }
}

/** An empty, throw-away database that lives only in memory. */
export async function scratchDatabase(): Promise<Target & { close(): Promise<void> }> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.waitReady;
  return {
    query: async (sql, params) => (await pg.query(sql, params as any[])).rows as Record<string, any>[],
    exec: async (sql) => { await pg.exec(sql); },
    close: () => pg.close(),
  };
}

export type RestoreTestOutcome = { ok: true; backup: string; rows: number; tables: number; ms: number } | { ok: false; backup?: string; error: string };

/** Rebuild a backup in a scratch database and check it, recording and telling nobody. Used by the command line and by runRestoreTest. */
export async function runRestoreTestOn(b: Backup, label = 'file'): Promise<RestoreTestOutcome> {
  const t0 = Date.now();
  let scratch: Awaited<ReturnType<typeof scratchDatabase>> | undefined;
  try {
    scratch = await scratchDatabase();
    await createSchema(scratch, b);
    const rep = await restoreBackup(scratch, b);
    return { ok: true, backup: label, rows: rep.rows, tables: rep.tables, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, backup: label, error: (e as Error)?.message ?? String(e) };
  } finally {
    await scratch?.close().catch(() => {});
  }
}

/** Restore a stored backup into a scratch database and check it. Proves the file can really be used. */
export async function runRestoreTest(name?: string, env: NodeJS.ProcessEnv = process.env): Promise<RestoreTestOutcome> {
  let picked = name;
  let out: RestoreTestOutcome;
  try {
    if (!picked) picked = (await listNamed('backups/daily/'))[0]?.name;
    if (!picked) throw new Error('there is no backup to test yet');
    if (!BACKUP_NAME.test(picked)) throw new Error('that is not a backup name');
    out = await runRestoreTestOn(decodeBackup(await getNamed(picked)), picked);
  } catch (e) {
    out = { ok: false, backup: picked, error: (e as Error)?.message ?? String(e) };
  }
  if (out.ok) {
    await query("insert into events (name, props) values ('restore_test', $1)", [JSON.stringify({ ok: true, backup: out.backup, rows: out.rows, tables: out.tables, ms: out.ms })]).catch(() => {});
  } else {
    await query("insert into events (name, props) values ('restore_test', $1)", [JSON.stringify({ ok: false, backup: picked, error: out.error.slice(0, 300) })]).catch(() => {});
    await siteAlert({ key: 'restore-test', what: `The monthly restore test failed (${out.error.slice(0, 160)}). The backup file may not be usable. Open the console, Setup page, and press Test a restore.`, error: new Error(out.error), repeatMinutes: 1440 }, env);
  }
  return out;
}

/* ------------------------------------------------------------------ the schedule */

type EventAt = { at: Date | string } | null;
const when = (e: EventAt) => (e ? new Date(e.at) : null);

/** Called every five minutes by the scheduler. Does the nightly backup and the monthly restore test when they are due. */
export async function runBackupIfDue(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<{ ran: string[] }> {
  const ran: string[] = [];
  if (!backupsEnabled(env).on) return { ran };
  const r = await withLock(BACKUP_LOCK, async () => {
    const last = async (name: string, where = '') => one<{ at: string }>(`select max(at) as at from events where name = $1 ${where}`, [name]).then((x) => (x?.at ? ({ at: x.at } as EventAt) : null));
    if (backupDue(now, when(await last('backup')), when(await last('backup_failed')))) {
      const out = await runBackup(now, env);
      ran.push(out.ok ? 'backup' : 'backup failed');
    }
    if ((await listNamed('backups/daily/')).length) {
      const okAt = when(await last('restore_test', "and props->>'ok' = 'true'"));
      const tryAt = when(await last('restore_test'));
      if (restoreTestDue(now, okAt, tryAt)) {
        const out = await runRestoreTest(undefined, env);
        ran.push(out.ok ? 'restore test' : 'restore test failed');
      }
    }
  });
  return { ran: r.ran ? ran : [] };
}

/** What the Setup page shows: the newest backup in storage (the truth), and how the last restore test went. */
export async function backupStatus(now = new Date()): Promise<{
  newest: StoredFile | null; count: number; monthly: number;
  lastFail: { at: Date; error: string } | null;
  restore: { at: Date; ok: boolean; rows?: number; error?: string } | null;
  lastRestoreOk: Date | null;
}> {
  const [daily, monthly] = await Promise.all([listNamed('backups/daily/'), listNamed('backups/monthly/')]);
  const newest = daily.reduce<StoredFile | null>((a, f) => (!a || f.modified > a.modified ? f : a), null);
  const fail = await one<{ at: string; props: any }>("select at, props from events where name = 'backup_failed' order by at desc limit 1");
  const okBackup = await one<{ at: string }>("select max(at) as at from events where name = 'backup'");
  const rt = await one<{ at: string; props: any }>("select at, props from events where name = 'restore_test' order by at desc limit 1");
  const rtOk = await one<{ at: string }>("select max(at) as at from events where name = 'restore_test' and props->>'ok' = 'true'");
  return {
    newest, count: daily.length, monthly: monthly.length,
    lastFail: fail && (!okBackup?.at || new Date(fail.at) > new Date(okBackup.at)) ? { at: new Date(fail.at), error: String(fail.props?.error ?? '') } : null,
    restore: rt ? { at: new Date(rt.at), ok: rt.props?.ok === true, rows: rt.props?.rows, error: rt.props?.error } : null,
    lastRestoreOk: rtOk?.at ? new Date(rtOk.at) : null,
  };
}
