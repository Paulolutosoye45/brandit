import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';

process.env.PGLITE_DIR = 'memory';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.DEMO_MODE = 'true';
const UPLOADS = path.join(os.tmpdir(), `brandit-backup-test-${process.pid}`);
process.env.UPLOAD_DIR = UPLOADS;
for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'ALERT_PHONE', 'SMS_API_KEY', 'SENTRY_DSN', 'RENDER', 'VERCEL']) delete process.env[k];

let db: typeof import('../lib/db');
let bk: typeof import('../lib/backup');
let st: typeof import('../lib/storage');
let alerts: typeof import('../lib/siteAlert');

beforeAll(async () => {
  db = await import('../lib/db');
  bk = await import('../lib/backup');
  st = await import('../lib/storage');
  alerts = await import('../lib/siteAlert');
  await db.ready();
  // A little real-looking history: a customer, an order with a payment, messages and events (these use identity counters).
  const c = await db.one<any>("insert into customers (phone, name, lang) values ('+2348031112222', 'Backup Tester', 'pcm') returning id");
  const o = await db.one<any>("insert into orders (code, customer_id, status, total_kobo, public_token, promise_reasons) values ('BR-' || nextval('order_seq'), $1, 'paid', 1550075, md5('t'), $2) returning id", [c.id, JSON.stringify(['a', 'b'])]);
  await db.query("insert into payments (order_id, provider_ref, amount_kobo, status) values ($1, 'BR-T-1', 1550075, 'success')", [o.id]);
  // An order and a custom request that point at each other, as they do in real life.
  const cr = await db.one<any>("insert into custom_requests (code, public_token, name, phone, title, details) values ('CQ-T1', 'tok-cq-t1', 'Tester', '+2348031112222', 'Wedding tees', 'details') returning id");
  await db.query('update orders set custom_request_id = $1 where id = $2', [cr.id, o.id]);
  await db.query('update custom_requests set order_id = $2 where id = $1', [cr.id, o.id]);
  for (let i = 0; i < 3; i++) await db.query("insert into messages (order_id, to_phone, template, vars, body, status) values ($1, '+2348031112222', 'paid', $2, $3, 'sent')", [o.id, JSON.stringify({ n: i, nested: { ok: true } }), `Hello “${i}” ₦1,000 \n line`]);
  for (let i = 0; i < 5; i++) await db.query("insert into events (name, props) values ('product_view', $1)", [JSON.stringify({ i })]);
});
beforeEach(() => { fs.rmSync(UPLOADS, { recursive: true, force: true }); alerts.resetSiteAlertMemory(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const NOW = new Date('2026-10-15T09:00:00Z'); // 10:00 in Lagos

describe('names and times (Lagos is UTC+1)', () => {
  it('names the files by the Lagos date', () => {
    expect(bk.lagosParts(new Date('2026-10-14T23:30:00Z'))).toEqual({ date: '2026-10-15', month: '2026-10', hour: 0 });
    expect(bk.dailyName(NOW)).toBe('backups/daily/2026-10-15.json.gz');
    expect(bk.monthlyName(new Date('2026-10-31T23:30:00Z'))).toBe('backups/monthly/2026-11.json.gz');
    expect(st.BACKUP_NAME.test(bk.dailyName(NOW))).toBe(true);
    expect(st.BACKUP_NAME.test(bk.monthlyName(NOW))).toBe(true);
  });
  it('accepts only checked names, so nothing can reach another file', async () => {
    for (const bad of ['../x.json.gz', 'backups/daily/../../x.json.gz', 'backups/daily/2026-10-15.json', 'x/backups/daily/2026-10-15.json.gz', 'backups/daily/2026-1-5.json.gz']) {
      expect(st.BACKUP_NAME.test(bad), bad).toBe(false);
      await expect(st.getNamed(bad)).rejects.toThrow(/Bad backup name/);
      await expect(st.putNamed(bad, Buffer.from('x'))).rejects.toThrow(/Bad backup name/);
    }
  });
  it('the nightly backup is due once a day, after 2am Lagos time', () => {
    const at = (s: string) => new Date(s);
    expect(bk.backupDue(NOW, null, null)).toBe(true); // never had one
    expect(bk.backupDue(at('2026-10-15T00:30:00Z'), at('2026-10-14T01:05:00Z'), null)).toBe(false); // 01:30 Lagos: not yet 2am, yesterday's was only 23 hours ago
    expect(bk.backupDue(at('2026-10-15T00:30:00Z'), at('2026-10-14T20:00:00Z'), null)).toBe(false); // 01:30 Lagos: too early, and last one was only 4.5h ago
    expect(bk.backupDue(at('2026-10-15T01:10:00Z'), at('2026-10-14T01:05:00Z'), null)).toBe(true); // 02:10 Lagos
    expect(bk.backupDue(at('2026-10-15T09:00:00Z'), at('2026-10-15T01:05:00Z'), null)).toBe(false); // done today
    expect(bk.backupDue(at('2026-10-16T09:00:00Z'), at('2026-10-15T01:05:00Z'), null)).toBe(true);
    expect(bk.backupDue(at('2026-10-16T00:00:00Z'), at('2026-10-14T01:05:00Z'), null)).toBe(true); // over 30 hours: do not wait for 2am
  });
  it('waits 30 minutes after a failure, then tries again', () => {
    const ok = new Date('2026-10-13T01:00:00Z');
    expect(bk.backupDue(new Date('2026-10-15T09:10:00Z'), ok, new Date('2026-10-15T09:00:00Z'))).toBe(false);
    expect(bk.backupDue(new Date('2026-10-15T09:31:00Z'), ok, new Date('2026-10-15T09:00:00Z'))).toBe(true);
  });
  it('the restore test is due every 30 days, and daily after a failure', () => {
    const d = (s: string) => new Date(s);
    expect(bk.restoreTestDue(NOW, null, null)).toBe(true);
    expect(bk.restoreTestDue(NOW, d('2026-09-30T00:00:00Z'), d('2026-09-30T00:00:00Z'))).toBe(false);
    expect(bk.restoreTestDue(NOW, d('2026-09-01T00:00:00Z'), d('2026-09-01T00:00:00Z'))).toBe(true);
    expect(bk.restoreTestDue(NOW, d('2026-09-01T00:00:00Z'), d('2026-10-15T01:00:00Z'))).toBe(false); // tried a few hours ago and failed
    expect(bk.restoreTestDue(NOW, null, d('2026-10-13T01:00:00Z'))).toBe(true);
  });
  it('is off in demo mode and on hosts with no lasting disk and no bucket, unless told otherwise', () => {
    expect(bk.backupsEnabled({ DEMO_MODE: 'true' } as any).on).toBe(false);
    expect(bk.backupsEnabled({ DEMO_MODE: 'true', BACKUPS: 'on' } as any).on).toBe(true);
    expect(bk.backupsEnabled({ DEMO_MODE: 'false' } as any).on).toBe(true);
    expect(bk.backupsEnabled({ DEMO_MODE: 'false', BACKUPS: 'off' } as any).on).toBe(false);
    const r = bk.backupsEnabled({ DEMO_MODE: 'false', RENDER: 'true' } as any);
    expect(r.on).toBe(false);
    expect(r.why).toMatch(/no file bucket/);
  });
});

describe('the backup file', () => {
  it('holds every table, the counters, and survives packing and unpacking', async () => {
    const b = await bk.dumpDatabase(NOW);
    expect(b.format).toBe('brandit-backup-1');
    expect(Object.keys(b.tables).length).toBeGreaterThan(40);
    expect(b.counts.orders).toBe(1);
    expect(b.counts.messages).toBe(3);
    expect(b.counts.events).toBeGreaterThanOrEqual(5);
    expect(b.migrations.length).toBeGreaterThan(5);
    expect(Number(b.sequences.order_seq)).toBeGreaterThanOrEqual(1001);
    expect(b.sequences.messages_id_seq).toBeDefined();
    const back = bk.decodeBackup(bk.encodeBackup(b));
    expect(back.tables.orders[0].total_kobo).toBe(1550075);
    expect(back.tables.messages[0].body).toContain('“0” ₦1,000 \n line');
  });
  it('refuses a file that is not a backup or has been damaged', async () => {
    expect(() => bk.decodeBackup(Buffer.from('hello'))).toThrow(/not a Brandit backup/);
    expect(() => bk.decodeBackup(gzipSync(Buffer.from('{"a":1}')))).toThrow(/wrong format/);
    const b = await bk.dumpDatabase(NOW);
    b.tables.orders = [];
    expect(() => bk.decodeBackup(gzipSync(Buffer.from(JSON.stringify(b))))).toThrow(/damaged: table orders/);
  });
});

describe('taking a backup (files on disk)', () => {
  it('stores the file, proves it by reading it back, and records it', async () => {
    const out = await bk.runBackup(NOW);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.name).toBe('backups/daily/2026-10-15.json.gz');
    expect(out.tables).toBeGreaterThan(40);
    expect(fs.existsSync(path.join(UPLOADS, out.name))).toBe(true);
    expect(fs.existsSync(path.join(UPLOADS, 'backups/monthly/2026-10.json.gz'))).toBe(true);
    const ev = await db.one<any>("select props from events where name = 'backup' order by at desc limit 1");
    expect(ev!.props.rows).toBe(out.rows);
    expect(bk.decodeBackup(await st.getNamed(out.name)).counts.orders).toBe(1);
  });
  it('keeps one monthly copy per month and replaces the daily one if run twice in a day', async () => {
    await bk.runBackup(NOW);
    const m1 = fs.statSync(path.join(UPLOADS, 'backups/monthly/2026-10.json.gz')).mtimeMs;
    await new Promise((r) => setTimeout(r, 15));
    const second = await bk.runBackup(new Date('2026-10-15T15:00:00Z'));
    expect(second.ok && second.monthly).toBeFalsy();
    expect(fs.statSync(path.join(UPLOADS, 'backups/monthly/2026-10.json.gz')).mtimeMs).toBe(m1);
    expect((await st.listNamed('backups/daily/')).map((f) => f.name)).toEqual(['backups/daily/2026-10-15.json.gz']);
  });
  it('keeps the newest 14 daily and 12 monthly copies and removes the rest', async () => {
    const stub = Buffer.from('x');
    for (let d = 1; d <= 20; d++) await st.putNamed(`backups/daily/2026-09-${String(d).padStart(2, '0')}.json.gz`, stub);
    for (let m = 1; m <= 12; m++) await st.putNamed(`backups/monthly/2025-${String(m).padStart(2, '0')}.json.gz`, stub);
    const out = await bk.runBackup(NOW);
    expect(out.ok).toBe(true);
    const daily = (await st.listNamed('backups/daily/')).map((f) => f.name);
    expect(daily).toHaveLength(14);
    expect(daily[0]).toBe('backups/daily/2026-10-15.json.gz');
    expect(daily).not.toContain('backups/daily/2026-09-01.json.gz');
    const monthly = (await st.listNamed('backups/monthly/')).map((f) => f.name);
    expect(monthly).toHaveLength(12);
    expect(monthly[0]).toBe('backups/monthly/2026-10.json.gz');
    expect(monthly).not.toContain('backups/monthly/2025-01.json.gz');
  });
});

describe('restoring', () => {
  it('brings back every row, the money, the order counter and the identity counters', async () => {
    await bk.runBackup(NOW);
    const out = await bk.runRestoreTest();
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.backup).toBe('backups/daily/2026-10-15.json.gz');
    expect(out.rows).toBeGreaterThan(100);
    const ev = await db.one<any>("select props from events where name = 'restore_test' order by at desc limit 1");
    expect(ev!.props.ok).toBe(true);
  });

  it('gives back exactly what was saved, including lists, JSON, dates and special characters', async () => {
    const b = bk.decodeBackup(bk.encodeBackup(await bk.dumpDatabase(NOW)));
    const s = await bk.scratchDatabase();
    try {
      await bk.createSchema(s, b);
      const rep = await bk.restoreBackup(s, b);
      expect(rep.problems).toEqual([]);
      const same = async (table: string, order: string) => {
        const live = (await db.query(`select * from ${table} order by ${order}`)).map((r) => JSON.stringify(r));
        const got = (await s.query(`select * from ${table} order by ${order}`)).map((r) => JSON.stringify(r));
        expect(got, table).toEqual(live);
      };
      await same('orders', 'code');
      await same('messages', 'id');
      await same('settings', 'key');
      await same('products', 'slug');
      await same('price_rules', 'id');
      await same('staff', 'email');
      const o = (await s.query("select promise_reasons from orders"))[0];
      expect(o.promise_reasons).toEqual(['a', 'b']);
      // The next order number carries on; it is never one already used.
      const used = Number(/\d+$/.exec((await s.query('select code from orders'))[0].code)![0]);
      expect(Number((await s.query("select nextval('order_seq') as n"))[0].n)).toBeGreaterThan(used);
      // New rows in identity tables get fresh numbers rather than clashing with restored ones.
      const maxMsg = Number((await s.query('select max(id) as m from messages'))[0].m);
      const ins = await s.query("insert into messages (to_phone, template, vars, body, status) values ('x','paid','{}','b','queued') returning id");
      expect(Number(ins[0].id)).toBeGreaterThan(maxMsg);
    } finally { await s.close(); }
  });

  it('replaces what was in the target, so a second restore does not double anything', async () => {
    const b = bk.decodeBackup(bk.encodeBackup(await bk.dumpDatabase(NOW)));
    const s = await bk.scratchDatabase();
    try {
      await bk.createSchema(s, b);
      await bk.restoreBackup(s, b);
      const again = await bk.restoreBackup(s, b);
      expect(again.problems).toEqual([]);
      expect(Number((await s.query('select count(*)::int as n from orders'))[0].n)).toBe(1);
    } finally { await s.close(); }
  });

  it('loads tables that point at each other (an order and its custom request), and checks every link', async () => {
    const b = await bk.dumpDatabase(NOW);
    const s = await bk.scratchDatabase();
    try {
      await bk.createSchema(s, b);
      await expect(bk.restoreBackup(s, b)).resolves.toMatchObject({ problems: [] });
      const o = (await s.query('select o.custom_request_id, c.order_id, o.id from orders o join custom_requests c on c.id = o.custom_request_id'))[0];
      expect(o.order_id).toBe(o.id);
      // The links are really back: a row pointing at nothing is refused.
      await expect(s.query("insert into payments (order_id, provider_ref, amount_kobo, status) values (gen_random_uuid(), 'x', 1, 'pending')")).rejects.toThrow(/foreign key/);
      expect(Number((await s.query("select count(*)::int as n from pg_constraint where contype = 'f'"))[0].n)).toBe(Number((await db.query("select count(*)::int as n from pg_constraint where contype = 'f'"))[0].n));
    } finally { await s.close(); }
  });

  it('changes nothing when a saved row points at something that is not there', async () => {
    const b = bk.decodeBackup(bk.encodeBackup(await bk.dumpDatabase(NOW)));
    const s = await bk.scratchDatabase();
    try {
      await bk.createSchema(s, b);
      await bk.restoreBackup(s, b);
      const broken = { ...b, tables: { ...b.tables, payments: b.tables.payments.map((p) => ({ ...p, order_id: '11111111-1111-1111-1111-111111111111' })) } };
      await expect(bk.restoreBackup(s, broken)).rejects.toThrow(/break a rule/);
      // The earlier good restore is still there.
      expect(Number((await s.query('select count(*)::int as n from orders'))[0].n)).toBe(1);
      expect(Number((await s.query("select count(*)::int as n from payments p join orders o on o.id = p.order_id"))[0].n)).toBe(1);
      expect(Number((await s.query("select count(*)::int as n from pg_constraint where contype = 'f'"))[0].n)).toBeGreaterThan(60);
    } finally { await s.close(); }
  });

  it('refuses a backup from a newer version of the site, and one for tables that are not there', async () => {
    const b = await bk.dumpDatabase(NOW);
    const s = await bk.scratchDatabase();
    try {
      await expect(bk.createSchema(s, { ...b, migrations: [...b.migrations, '999_future'] })).rejects.toThrow(/newer version/);
      await expect(bk.restoreBackup(s, b)).rejects.toThrow(/has no table/);
    } finally { await s.close(); }
  });

  it('notices a restore that does not add up', async () => {
    const b = bk.decodeBackup(bk.encodeBackup(await bk.dumpDatabase(NOW)));
    b.counts.orders = 1;
    b.tables.orders[0].total_kobo = 1550075;
    const bad = { ...b, tables: { ...b.tables, payments: b.tables.payments.map((p) => ({ ...p, amount_kobo: 'oops' })) } };
    const s = await bk.scratchDatabase();
    try {
      await bk.createSchema(s, bad);
      await expect(bk.restoreBackup(s, bad)).rejects.toThrow();
      expect(Number((await s.query('select count(*)::int as n from orders'))[0].n)).toBe(0);
    } finally { await s.close(); }
  });

  it('reports a damaged stored file as a failed test, records it, and does not throw', async () => {
    await st.putNamed('backups/daily/2026-10-14.json.gz', Buffer.from('garbage'));
    const out = await bk.runRestoreTest('backups/daily/2026-10-14.json.gz');
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/not a Brandit backup/);
    const ev = await db.one<any>("select props from events where name = 'restore_test' order by at desc limit 1");
    expect(ev!.props.ok).toBe(false);
  });
  it('says so when there is nothing to test', async () => {
    const out = await bk.runRestoreTest();
    expect(out).toMatchObject({ ok: false });
    expect(out.ok === false && out.error).toMatch(/no backup to test/);
  });
});

describe('a backup that fails tells the owner', () => {
  it('records the failure and sends one phone message', async () => {
    const sms: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => { try { sms.push(JSON.parse(init.body).sms); } catch { /* not an sms */ } return new Response('{}', { status: 200 }); }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.ALERT_PHONE = '2348031234567';
    process.env.SMS_API_KEY = 'k';
    // The storage folder cannot be created because a file is in the way.
    fs.mkdirSync(UPLOADS, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS, 'backups'), 'in the way');
    try {
      const a = await bk.runBackup(NOW);
      const b = await bk.runBackup(NOW);
      expect(a.ok).toBe(false);
      expect(b.ok).toBe(false);
      expect(sms.filter(Boolean)).toHaveLength(1);
      expect(sms[0]).toMatch(/nightly backup failed/);
      const ev = await db.one<any>("select props from events where name = 'backup_failed' order by at desc limit 1");
      expect(ev).toBeTruthy();
    } finally { delete process.env.ALERT_PHONE; delete process.env.SMS_API_KEY; }
  });
});

/** A bucket held in memory, speaking just enough S3 for the backup code. */
function fakeS3() {
  const files = new Map<string, Buffer>();
  const modified = new Map<string, string>();
  const calls: string[] = [];
  const handler = async (input: any, init?: any) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    calls.push(`${req.method} ${url.pathname}${url.search}`);
    const key = decodeURIComponent(url.pathname.replace(/^\/bucket\/?/, ''));
    if (req.method === 'PUT') { files.set(key, Buffer.from(await req.arrayBuffer())); modified.set(key, '2026-10-15T01:00:00.000Z'); return new Response('', { status: 200 }); }
    if (req.method === 'DELETE') { files.delete(key); return new Response('', { status: 204 }); }
    if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const after = url.searchParams.get('continuation-token');
      const keys = [...files.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = after ? keys.indexOf(after) : 0;
      const page = keys.slice(start, start + 2); // two at a time, to exercise paging
      const more = start + 2 < keys.length;
      const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${keys[start + 2]}</NextContinuationToken>` : ''}${page.map((k) => `<Contents><Key>${k}</Key><LastModified>${modified.get(k)}</LastModified><Size>${files.get(k)!.length}</Size></Contents>`).join('')}</ListBucketResult>`;
      return new Response(xml, { status: 200 });
    }
    if (req.method === 'GET') return files.has(key) ? new Response(new Uint8Array(files.get(key)!), { status: 200 }) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
    return new Response('', { status: 405 });
  };
  return { files, calls, handler };
}

describe('backups in an S3-compatible bucket (Cloudflare R2)', () => {
  const useS3 = () => {
    process.env.S3_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
    process.env.S3_BUCKET = 'bucket';
    process.env.S3_ACCESS_KEY_ID = 'id';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
  };
  afterEach(() => { for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) delete process.env[k]; });

  it('uploads, reads back, lists across pages, tidies and restores', async () => {
    const s3 = fakeS3();
    vi.stubGlobal('fetch', vi.fn(s3.handler));
    useS3();
    for (let d = 1; d <= 16; d++) s3.files.set(`backups/daily/2026-09-${String(d).padStart(2, '0')}.json.gz`, Buffer.from('x'));
    const out = await bk.runBackup(NOW);
    expect(out.ok).toBe(true);
    expect([...s3.files.keys()].filter((k) => k.startsWith('backups/daily/'))).toHaveLength(14);
    expect(s3.files.has('backups/monthly/2026-10.json.gz')).toBe(true);
    const listed = await st.listNamed('backups/daily/');
    expect(listed[0].name).toBe('backups/daily/2026-10-15.json.gz');
    expect(listed[0].bytes).toBeGreaterThan(1000);
    expect(listed[0].modified).toBeInstanceOf(Date);
    expect(s3.calls.some((c) => c.includes('continuation-token'))).toBe(true);
    const test = await bk.runRestoreTest();
    expect(test.ok).toBe(true);
  });

  it('fails clearly (and does not pretend) when the bucket refuses the upload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useS3();
    const out = await bk.runBackup(NOW);
    expect(out).toMatchObject({ ok: false });
    expect(out.ok === false && out.error).toMatch(/403 AccessDenied/);
  });

  it('fails when what comes back is not what was sent', async () => {
    const s3 = fakeS3();
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      const req = input instanceof Request ? input : new Request(input, init);
      if (req.method === 'GET' && !new URL(req.url).searchParams.has('list-type')) return new Response(new Uint8Array(Buffer.from('truncated')), { status: 200 });
      return s3.handler(input, init);
    }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useS3();
    const out = await bk.runBackup(NOW);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/not the same/);
  });
});

describe('the schedule', () => {
  it('does nothing in demo mode, and does a backup then a restore test when switched on', async () => {
    expect(await bk.runBackupIfDue(NOW, { DEMO_MODE: 'true' } as any)).toEqual({ ran: [] });
    expect(fs.existsSync(path.join(UPLOADS, 'backups'))).toBe(false);
    const env = { DEMO_MODE: 'true', BACKUPS: 'on' } as any;
    await db.query("delete from events where name in ('backup','backup_failed','restore_test')");
    expect((await bk.runBackupIfDue(NOW, env)).ran).toEqual(['backup', 'restore test']);
    // The schedule is judged against the clock the test passes in, so the records must carry that clock too (not the real one).
    await db.query("update events set at = $1 where name in ('backup','backup_failed','restore_test')", [NOW.toISOString()]);
    // Five minutes later nothing is due.
    expect((await bk.runBackupIfDue(new Date(NOW.getTime() + 5 * 60_000), env)).ran).toEqual([]);
    // Next night at 2:10 Lagos time only the backup is due.
    expect((await bk.runBackupIfDue(new Date('2026-10-16T01:10:00Z'), env)).ran).toEqual(['backup']);
  });

  it('reports what the Setup page needs', async () => {
    await db.query("delete from events where name in ('backup','backup_failed','restore_test')");
    await bk.runBackup(NOW);
    await bk.runRestoreTest();
    const s = await bk.backupStatus();
    expect(s.newest?.name).toBe('backups/daily/2026-10-15.json.gz');
    expect(s.count).toBe(1);
    expect(s.monthly).toBe(1);
    expect(s.lastFail).toBeNull();
    expect(s.restore).toMatchObject({ ok: true });
    expect(s.lastRestoreOk).toBeInstanceOf(Date);
  });
});

describe('Setup: the Backups checks', () => {
  const LIVE = { DEMO_MODE: 'false', NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), NEXT_PUBLIC_APP_URL: 'https://thebrandit.ng' };
  const checks = async (extra: Record<string, string> = {}) => {
    const { setupChecks } = await import('../lib/setup');
    const r = await setupChecks({ ...LIVE, ...extra } as any);
    return (id: string) => r.checks.find((c) => c.id === id)!;
  };
  const clear = () => db.query("delete from events where name in ('backup','backup_failed','restore_test')");

  it('says there is no backup yet, with what to press', async () => {
    await clear();
    const c = (await checks())('backup');
    expect(c.status).toBe('warn');
    expect(c.detail).toMatch(/no backup yet/);
    expect(c.fix).toMatch(/Back up now/);
  });
  it('is green after a backup and a restore test', async () => {
    await clear();
    await bk.runBackup(new Date());
    await bk.runRestoreTest();
    const get = await checks();
    expect(get('backup').status).toBe('ok');
    expect(get('backup').detail).toMatch(/Last backup less than an hour ago/);
    expect(get('restore').status).toBe('ok');
    expect(get('restore').detail).toMatch(/all [\d,]+ saved rows came back/);
  });
  it('turns amber then red as the newest backup gets old', async () => {
    await clear();
    await bk.runBackup(new Date());
    const file = path.join(UPLOADS, bk.dailyName(new Date()));
    const age = (h: number) => { const t = new Date(Date.now() - h * 3_600_000); fs.utimesSync(file, t, t); };
    age(30);
    expect((await checks())('backup')).toMatchObject({ status: 'warn' });
    age(60);
    const red = (await checks())('backup');
    expect(red.status).toBe('bad');
    expect(red.detail).toMatch(/2 days ago|3 days ago/);
  });
  it('is red when the restore test failed', async () => {
    await clear();
    await bk.runBackup(new Date());
    await db.query("insert into events (name, props) values ('restore_test', $1)", [JSON.stringify({ ok: false, error: 'something broke' })]);
    const c = (await checks())('restore');
    expect(c.status).toBe('bad');
    expect(c.detail).toMatch(/something broke/);
  });
  it('is red on a host with no lasting disk and no bucket, and quiet in demo mode', async () => {
    expect((await checks({ RENDER: 'true' }))('backup')).toMatchObject({ status: 'bad' });
    expect((await checks({ DEMO_MODE: 'true' }))('backup')).toMatchObject({ status: 'info', detail: 'Off in demo mode.' });
  });
});
