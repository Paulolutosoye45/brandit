import { beforeAll, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = process.env.DATABASE_URL ? (process.env.PGLITE_DIR ?? 'memory') : 'memory';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-hard-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';

let db: typeof import('../lib/db');
let sched: typeof import('../lib/scheduler');

beforeAll(async () => {
  db = await import('../lib/db');
  sched = await import('../lib/scheduler');
  await db.ready();
});

describe('visitor addresses cannot be faked into a bypass', () => {
  it('counts back from the end, where only your own proxies write', async () => {
    const { clientIp } = await import('../lib/clientip');
    // The visitor sends "6.6.6.6", their real address is 41.1.1.1, and two proxies of ours add to the end.
    const chain = '6.6.6.6, 41.1.1.1, 10.0.0.2';
    expect(clientIp(chain, 2)).toBe('41.1.1.1');
    expect(clientIp(`9.9.9.9, ${chain}`, 2)).toBe('41.1.1.1');          // more faking at the front changes nothing
    expect(clientIp(chain, 0)).toBe('6.6.6.6');                           // unset: old behaviour
    expect(clientIp(chain, 9)).toBe('6.6.6.6');                           // more hops than entries: never crash
    expect(clientIp(null, 2)).toBe('local');
    expect(clientIp('  ', 1)).toBe('local');
    expect(clientIp('41.1.1.1', 1)).toBe('41.1.1.1');
    expect(clientIp(chain, Number.NaN)).toBe('6.6.6.6');
  });

  it('locks a team account after ten wrong tries from any number of made-up addresses', async () => {
    const { tooManyStaffLoginTries } = await import('../lib/loginGuard');
    const email = `guess-${Date.now()}@brandit.test`;
    let blockedAt = 0;
    for (let i = 1; i <= 14; i++) if (tooManyStaffLoginTries(email, `10.0.${i}.1`) && !blockedAt) blockedAt = i; // a new address every time
    expect(blockedAt).toBe(11);
    expect(tooManyStaffLoginTries(`someone-else-${Date.now()}@brandit.test`, '10.0.99.1')).toBe(false);  // other accounts are unaffected
  });
});

describe('the database connection', () => {
  it('survives an idle connection error instead of ending the process', () => {
    const pool = new EventEmitter();
    expect(() => pool.emit('error', new Error('x'))).toThrow();            // without a listener, Node ends the process
    db.attachPoolGuards(pool as any);
    expect(() => pool.emit('error', new Error('connection reset'))).not.toThrow();
  });

  it('lets only one caller hold a lock at a time', async () => {
    let running = 0, peak = 0, ran = 0;
    const work = async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 60)); running--; ran++; return 'done'; };
    const results = await Promise.all([db.withLock(424242, work), db.withLock(424242, work), db.withLock(424242, work)]);
    expect(results.filter((r) => r.ran)).toHaveLength(1);
    expect(peak).toBe(1);
    expect(ran).toBe(1);
    expect((await db.withLock(424242, async () => 'again')).ran).toBe(true);   // free again afterwards
    expect((await db.withLock(1, async () => 'other key')).ran).toBe(true);
  });
});

describe('the late-order check', () => {
  it('never runs twice at once, and tidies up sign-in codes nobody used', async () => {
    await db.query("insert into login_codes (channel, identifier, code_hash, expires_at) values ('email','old@example.com','x', now() - interval '3 days') on conflict do nothing");
    await db.query("insert into login_codes (channel, identifier, code_hash, expires_at) values ('email','fresh@example.com','x', now() + interval '5 minutes') on conflict do nothing");
    const both = await Promise.all([sched.runScheduledSweep(), sched.runScheduledSweep()]);
    expect(both.filter((r) => r.skipped)).toHaveLength(1);
    const left = (await db.query<any>("select identifier from login_codes where identifier in ('old@example.com','fresh@example.com')")).map((r) => r.identifier);
    expect(left).toEqual(['fresh@example.com']);
  });
});

describe('the schema protects itself', () => {
  it('has an index on every column the app joins by', async () => {
    const names = (await db.query<any>("select indexname from pg_indexes where schemaname = 'public'")).map((r) => r.indexname);
    for (const n of ['price_rules_product_idx', 'order_items_order_idx', 'jobs_order_idx', 'job_events_job_idx', 'payments_order_idx', 'files_order_idx', 'messages_order_idx', 'proofs_item_idx', 'sign_ins_customer_idx']) expect(names, n).toContain(n);
  });

  it('refuses a negative price, fee or total', async () => {
    const p = (await db.one<any>('select id from products limit 1'))!;
    await expect(db.query('insert into price_rules (product_id, quantity, price_kobo) values ($1, 7, -1)', [p.id])).rejects.toThrow(/price_rules_nonneg|check/i);
    await expect(db.query("insert into delivery_zones (name, fee_kobo) values ('bad zone', -500)")).rejects.toThrow(/delivery_zones_fee_nonneg|check/i);
  });

  it('allows only one automatic "late" claim per order', async () => {
    const c = (await db.one<any>("insert into customers (phone, name) values ('+2348039990001','Late Test') returning id"))!;
    const o = (await db.one<any>("insert into orders (code, public_token, customer_id, status) values ('BR-9901','tok-late-9901', $1, 'paid') returning id", [c.id]))!;
    expect(o.id).toBeTruthy();   // if this ever fails the test must say so, never quietly pass
    await db.query("insert into claims (order_id, kind, source, status) values ($1,'late','system','resolved')", [o.id]);
    await expect(db.query("insert into claims (order_id, kind, source, status) values ($1,'late','system','resolved')", [o.id])).rejects.toThrow(/duplicate|unique/i);
    await db.query("insert into claims (order_id, kind, source, status) values ($1,'late','customer','open')", [o.id]);   // a customer's own report is still allowed
  });

  it('has that unique index in place', async () => {
    const r = await db.one<any>("select indexdef from pg_indexes where indexname = 'claims_one_system_late_idx'");
    expect(r?.indexdef).toMatch(/UNIQUE/i);
  });
});
