import { beforeAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'true';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-reminders-${process.pid}`);
delete process.env.PAYSTACK_SECRET_KEY;

let db: typeof import('../lib/db');
let O: typeof import('../lib/orders');
let R: typeof import('../lib/reminders');
let Pay: typeof import('../lib/payments');
let I: typeof import('../lib/identity');
let S: typeof import('../lib/settings');
let SP: typeof import('../lib/samplePack');
import { lagosDate, lagosParts } from '../lib/time';

beforeAll(async () => {
  db = await import('../lib/db');
  await db.ready();
  O = await import('../lib/orders');
  R = await import('../lib/reminders');
  Pay = await import('../lib/payments');
  I = await import('../lib/identity');
  S = await import('../lib/settings');
  SP = await import('../lib/samplePack');
}, 60_000);

let n = 0;
/** A paid order for a new customer. */
async function paid(opts: { slug?: string; optIn?: boolean } = {}) {
  n++;
  const c = (await I.signInEmail(`rm${n}@example.com`)).customer;
  const slug = opts.slug ?? 'flyers';
  const d: any = await O.createDraft({ slug, quantity: slug === SP.SAMPLE_SLUG ? 1 : 100, area: 'Yaba' });
  expect(d.id, JSON.stringify(d)).toBeTruthy();
  await db.query('update orders set customer_id = $2 where id = $1', [d.id, c.id]);
  const item = (await O.getItem(d.id))!;
  if (slug !== SP.SAMPLE_SLUG) {
    const f = await db.one<{ id: string }>(
      "insert into files (order_id, order_item_id, kind, storage_key, original_name, mime, bytes, width_px, height_px, check_result) values ($1,$2,'artwork','x.png','art.png','image/png',1000,3000,2000,'{\"status\":\"pass\"}') returning id",
      [d.id, item.id]);
    await db.query("update order_items set artwork_path = 'upload', artwork_file_id = $2, preview_approved_at = now() where id = $1", [item.id, f!.id]);
  }
  const ck = await O.saveCheckout(d.id, { name: 'Ngozi Eze', phone: `0806${String(3000000 + n).slice(-7)}`, email: c.email ?? '', pickup: false, area: 'Yaba', addressLine: '12 Test Street, Yaba' }, c.id);
  expect(ck.ok, JSON.stringify(ck)).toBe(true);
  const o = (await O.getOrder(d.id))!;
  const pay = await Pay.initPayment(o, c.email ?? 'a@example.com');
  expect((await O.confirmPayment({ reference: pay.reference, amountKobo: o.total_kobo, method: 'card' })).ok).toBe(true);
  if (opts.optIn) await db.query('update customers set marketing_opt_in = true where id = $1', [c.id]);
  return { c, id: d.id as string, token: (await O.getOrder(d.id))!.public_token as string };
}
const delivered = (id: string, daysAgo: number) => db.query("update orders set status = 'delivered', delivered_at = now() - ($2 || ' days')::interval where id = $1", [id, String(daysAgo)]);
const messagesFor = (id: string, template: string) => db.query<any>('select * from messages where order_id = $1 and template = $2', [id, template]);

// Thursday 22 October 2026, 11:00 in Lagos (10:00 UTC).
const THU_11 = new Date('2026-10-22T10:00:00Z');
/** Today at 11am in Lagos, so the "nothing at night" rule does not depend on when the tests run. */
const midday = () => lagosDate(lagosParts(new Date()).ymd, '11:00');

describe('when the next weekly reminder falls', () => {
  it('is the chosen weekday at 8am Lagos time, always in the future', () => {
    // Wednesday noon -> Thursday 8am
    expect(R.nextWeekly(new Date('2026-10-21T11:00:00Z'), 4).toISOString()).toBe('2026-10-22T07:00:00.000Z');
    // Thursday after 8am -> a week later
    expect(R.nextWeekly(THU_11, 4).toISOString()).toBe('2026-10-29T07:00:00.000Z');
    // Exactly 8am is not "after", so it moves on
    expect(R.nextWeekly(new Date('2026-10-22T07:00:00Z'), 4).toISOString()).toBe('2026-10-29T07:00:00.000Z');
    // Sunday is 7
    expect(R.nextWeekly(THU_11, 7).toISOString()).toBe('2026-10-25T07:00:00.000Z');
    // Monday is 1
    expect(R.nextWeekly(THU_11, 1).toISOString()).toBe('2026-10-26T07:00:00.000Z');
  });
});

describe('asking for a weekly reminder', () => {
  it('works for the owner of a paid order, and moving the day moves the same reminder', async () => {
    const t = await paid();
    const a = await R.startWeekly(t.c.id, t.token, 4, THU_11);
    expect(a.ok).toBe(true);
    const b = await R.startWeekly(t.c.id, t.token, 1, THU_11);
    expect(b.ok).toBe(true);
    const rows = await db.query<any>("select * from reminders where customer_id = $1 and kind = 'weekly' and active", [t.c.id]);
    expect(rows.length).toBe(1);
    expect(rows[0].weekday).toBe(1);
    expect(new Date(rows[0].next_at).toISOString()).toBe('2026-10-26T07:00:00.000Z');
    expect((await R.weeklyFor(t.c.id)).get(t.id)?.weekday).toBe(1);
  });

  it('refuses another customer, an unpaid order, a custom order and a day that does not exist', async () => {
    const t = await paid();
    const other = (await I.signInEmail(`rm-other${n}@example.com`)).customer;
    expect((await R.startWeekly(other.id, t.token, 4)).ok).toBe(false);
    expect((await R.startWeekly(t.c.id, t.token, 0)).ok).toBe(false);
    expect((await R.startWeekly(t.c.id, t.token, 8)).ok).toBe(false);
    const d: any = await O.createDraft({ slug: 'flyers', quantity: 100, area: 'Yaba' });
    await db.query('update orders set customer_id = $2 where id = $1', [d.id, t.c.id]);
    const draft = (await O.getOrder(d.id))!;
    expect((await R.startWeekly(t.c.id, draft.public_token, 4)).ok).toBe(false);
  });
});

describe('sending weekly reminders', () => {
  it('sends one when due, with a one-tap order link and a stop link, then waits a week', async () => {
    const t = await paid();
    await R.startWeekly(t.c.id, t.token, 4, new Date('2026-10-14T10:00:00Z'));
    const due = (await db.one<any>("select * from reminders where customer_id = $1", [t.c.id]))!;
    expect(new Date(due.next_at).toISOString()).toBe('2026-10-15T07:00:00.000Z');
    const r = await R.sendReminders(THU_11);
    expect(r.weekly).toBeGreaterThanOrEqual(1);
    const msgs = await messagesFor(t.id, 'reorder_weekly');
    expect(msgs.length).toBe(1);
    expect(msgs[0].body).toContain(`/reorder/${t.token}`);
    expect(msgs[0].body).toContain(`/reminders/stop/${due.stop_token}`);
    const after = (await db.one<any>('select * from reminders where id = $1', [due.id]))!;
    expect(new Date(after.next_at).toISOString()).toBe('2026-10-29T07:00:00.000Z');
    expect(after.sent_count).toBe(1);
    await R.sendReminders(THU_11);
    expect((await messagesFor(t.id, 'reorder_weekly')).length).toBe(1);
  });

  it('sends nothing at night, when switched off, or to someone who turned reminders off', async () => {
    const t = await paid();
    await R.startWeekly(t.c.id, t.token, 4, new Date('2026-10-14T10:00:00Z'));
    await R.sendReminders(new Date('2026-10-22T21:30:00Z')); // 22:30 Lagos
    expect((await messagesFor(t.id, 'reorder_weekly')).length).toBe(0);
    await S.setSetting('reminders_enabled', false);
    await R.sendReminders(THU_11);
    expect((await messagesFor(t.id, 'reorder_weekly')).length).toBe(0);
    await S.setSetting('reminders_enabled', true);
    await db.query('update customers set reminders_ok = false where id = $1', [t.c.id]);
    await R.sendReminders(THU_11);
    expect((await messagesFor(t.id, 'reorder_weekly')).length).toBe(0);
  });
});

describe('"running low" reminders', () => {
  it('goes once, about 90 days after delivery, to someone who agreed to hear from us', async () => {
    const t = await paid({ optIn: true });
    await delivered(t.id, 95);
    await R.sendReminders(midday());
    expect((await messagesFor(t.id, 'reorder_reminder')).length).toBe(1);
    await R.sendReminders(midday());
    expect((await messagesFor(t.id, 'reorder_reminder')).length).toBe(1);
  });

  it('does not go to someone who did not agree, is too new or too old, or has ordered again', async () => {
    const quiet = await paid({ optIn: false });
    await delivered(quiet.id, 95);
    const fresh = await paid({ optIn: true });
    await delivered(fresh.id, 20);
    const old = await paid({ optIn: true });
    await delivered(old.id, 200);
    const again = await paid({ optIn: true });
    await delivered(again.id, 95);
    // The customer ordered again after that delivery.
    const d: any = await O.createDraft({ slug: 'flyers', quantity: 100, area: 'Yaba' });
    await db.query("update orders set customer_id = $2, status = 'paid', paid_at = now() where id = $1", [d.id, again.c.id]);
    await R.sendReminders(midday());
    for (const x of [quiet, fresh, old, again]) expect((await messagesFor(x.id, 'reorder_reminder')).length).toBe(0);
  });

  it('is not sent for a sample pack', async () => {
    const t = await paid({ slug: SP.SAMPLE_SLUG, optIn: true });
    await delivered(t.id, 95);
    await R.sendReminders(midday());
    expect((await messagesFor(t.id, 'reorder_reminder')).length).toBe(0);
  });

  it('sends one message to a person with two old orders, not two', async () => {
    const t = await paid({ optIn: true });
    await delivered(t.id, 95);
    const d: any = await O.createDraft({ slug: 'flyers', quantity: 200, area: 'Yaba' });
    await db.query("update orders set customer_id = $2, status = 'delivered', paid_at = now() - interval '100 days', delivered_at = now() - interval '94 days' where id = $1", [d.id, t.c.id]);
    await db.query("update orders set paid_at = now() - interval '110 days' where id = $1", [t.id]);
    await R.sendReminders(midday());
    const all = await db.query<any>("select m.id from messages m join orders o on o.id = m.order_id where o.customer_id = $1 and m.template = 'reorder_reminder'", [t.c.id]);
    expect(all.length).toBe(1);
  });
});

describe('stopping', () => {
  it('stops one weekly reminder from the link without signing in, and the order stays', async () => {
    const t = await paid();
    await R.startWeekly(t.c.id, t.token, 4);
    const r = (await db.one<any>('select * from reminders where customer_id = $1', [t.c.id]))!;
    const seen = await R.reminderByToken(r.stop_token);
    expect(seen?.kind).toBe('weekly');
    expect((await R.stopByToken(r.stop_token, false)).ok).toBe(true);
    expect((await db.one<any>('select active from reminders where id = $1', [r.id]))!.active).toBe(false);
    expect((await db.one<any>('select reminders_ok from customers where id = $1', [t.c.id]))!.reminders_ok).toBe(true);
  });

  it('stops everything for the person, and asking for a new reminder switches it back on', async () => {
    const t = await paid();
    await R.startWeekly(t.c.id, t.token, 4);
    const r = (await db.one<any>('select * from reminders where customer_id = $1', [t.c.id]))!;
    await R.stopByToken(r.stop_token, true);
    const c = (await db.one<any>('select reminders_ok from customers where id = $1', [t.c.id]))!;
    expect(c.reminders_ok).toBe(false);
    expect((await db.query('select 1 from reminders where customer_id = $1 and active', [t.c.id])).length).toBe(0);
    expect((await R.startWeekly(t.c.id, t.token, 2)).ok).toBe(true);
    expect((await db.one<any>('select reminders_ok from customers where id = $1', [t.c.id]))!.reminders_ok).toBe(true);
  });

  it('ignores a made-up link', async () => {
    expect((await R.stopByToken('nope', true)).ok).toBe(false);
    expect((await R.stopByToken('x'.repeat(18), true)).ok).toBe(false);
    expect(await R.reminderByToken('../etc')).toBeNull();
  });
});
