import { query, one, tx } from './db';
import { getSettings, type Settings } from './settings';
import { randomCode } from './couponCore';
import { appUrl, queueMessage } from './messages';
import { naira } from './money';
import { contactPhone } from './identity';
import type { Coupon } from './coupons';

/*
 * Referral codes, built on the coupon engine.
 *  - Every customer can have one personal code (a coupon that belongs to them). A friend who types it, or opens the
 *    share link, takes a percentage off their FIRST order. The owner cannot use their own code.
 *  - When the friend's order is delivered, the owner earns a reward code: a fixed amount off their next order,
 *    valid for a limited time and usable only by them.
 *  - One reward per friend, and a cap on rewards per person. All the numbers are settings.
 */
const prefixOf = (name: string | null | undefined) => {
  const first = (name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/)[0]?.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 6) ?? '';
  return first.length >= 3 ? first : 'BRAND';
};

export const shareLink = (code: string) => `${appUrl()}/?code=${encodeURIComponent(code)}`;

export function shareText(code: string, friendPercent: number): string {
  return `I print with Brandit in Lagos. Use my code ${code} for ${friendPercent}% off your first order: ${shareLink(code)}`;
}

/** The customer's personal code. Made the first time it is needed. Null when referrals are switched off. */
export async function ensureReferralCode(customerId: string): Promise<Coupon | null> {
  const s = await getSettings();
  if (!s.referral_enabled) return null;
  const have = await one<Coupon>("select * from coupons where source = 'referral' and owner_customer_id = $1", [customerId]);
  if (have) return have;
  const c = await one<{ name: string | null }>('select name from customers where id = $1', [customerId]);
  if (!c) return null;
  const first = (c.name ?? '').trim().split(/\s+/)[0] || 'A friend';
  for (let i = 0; i < 6; i++) {
    const code = randomCode(prefixOf(c.name));
    const row = await one<Coupon>(
      `insert into coupons (code, description, kind, percent_off, max_discount_kobo, min_subtotal_kobo, max_per_customer, first_order_only, product_ids, active, source, owner_customer_id)
       values ($1,$2,'percent',$3,$4,0,1,true,'{}',true,'referral',$5)
       on conflict do nothing returning *`,
      [code, `A gift from ${first.slice(0, 30)}`, s.referral_friend_percent, s.referral_friend_cap_kobo > 0 ? s.referral_friend_cap_kobo : null, customerId],
    );
    if (row) return row;
    // Either the code collided, or another request just made this person's code. Look again before trying a new one.
    const again = await one<Coupon>("select * from coupons where source = 'referral' and owner_customer_id = $1", [customerId]);
    if (again) return again;
  }
  return null;
}

/** When the numbers change in the console, every personal code follows. */
export async function syncReferralCoupons(s: Pick<Settings, 'referral_friend_percent' | 'referral_friend_cap_kobo'>) {
  await query("update coupons set percent_off = $1, max_discount_kobo = $2 where source = 'referral'", [s.referral_friend_percent, s.referral_friend_cap_kobo > 0 ? s.referral_friend_cap_kobo : null]);
}

export type ReferralSummary = {
  code: string;
  link: string;
  percent: number;
  rewardKobo: number;
  friendsOrdered: number;
  friendsWaiting: number;
  earned: number;
  earnedKobo: number;
  rewards: { code: string; amountKobo: number; endsAt: string | null; usable: boolean; used: boolean }[];
};

export async function referralSummary(customerId: string, now = new Date()): Promise<ReferralSummary | null> {
  const s = await getSettings();
  const cp = await ensureReferralCode(customerId);
  if (!cp) return null;
  const friends = await one<{ ordered: number; delivered: number }>(
    `select count(distinct r.customer_id) filter (where o.paid_at is not null)::int as ordered,
            count(distinct r.customer_id) filter (where o.status = 'delivered')::int as delivered
       from coupon_redemptions r join orders o on o.id = r.order_id where r.coupon_id = $1`,
    [cp.id],
  );
  const rewards = await query<any>(
    `select c.code, c.amount_off_kobo, c.ends_at, c.active,
            exists (select 1 from coupon_redemptions r where r.coupon_id = c.id) as used
       from referral_rewards w join coupons c on c.id = w.reward_coupon_id
      where w.referrer_id = $1 order by w.created_at desc limit 20`,
    [customerId],
  );
  const ordered = friends?.ordered ?? 0;
  const delivered = friends?.delivered ?? 0;
  return {
    code: cp.code,
    link: shareLink(cp.code),
    percent: s.referral_friend_percent,
    rewardKobo: s.referral_reward_kobo,
    friendsOrdered: ordered,
    friendsWaiting: Math.max(0, ordered - delivered),
    earned: rewards.length,
    earnedKobo: rewards.reduce((n, r) => n + (r.amount_off_kobo ?? 0), 0),
    rewards: rewards.map((r) => ({
      code: r.code,
      amountKobo: r.amount_off_kobo ?? 0,
      endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
      used: !!r.used,
      usable: !!r.active && !r.used && (!r.ends_at || new Date(r.ends_at) > now),
    })),
  };
}

/** Pay out rewards for friends whose first order has been delivered. Safe to run again and again. */
export async function issueReferralRewards(now = new Date()): Promise<number> {
  const s = await getSettings();
  if (!s.referral_enabled) return 0;
  const due = await query<any>(
    `select r.order_id, r.customer_id as friend_id, c.owner_customer_id as referrer_id
       from coupon_redemptions r
       join coupons c on c.id = r.coupon_id and c.source = 'referral'
       join orders o on o.id = r.order_id and o.status = 'delivered'
      where r.customer_id is not null and c.owner_customer_id is not null and r.customer_id <> c.owner_customer_id
        and not exists (select 1 from referral_rewards w where w.order_id = r.order_id)
        and not exists (select 1 from referral_rewards w2 where w2.referrer_id = c.owner_customer_id and w2.friend_id = r.customer_id)
      order by o.delivered_at limit 50`,
  );
  let paid = 0;
  for (const d of due) {
    const referrer = await one<any>('select id, name, phone, whatsapp_phone, lang from customers where id = $1', [d.referrer_id]);
    const friend = await one<any>('select name from customers where id = $1', [d.friend_id]);
    const have = await one<{ n: number }>('select count(*)::int as n from referral_rewards where referrer_id = $1 and reward_coupon_id is not null', [d.referrer_id]);
    const to = referrer ? contactPhone(referrer) : null;
    // A reward we cannot or will not give is still recorded, so this order is not looked at again.
    const skip = !referrer || !to || (have?.n ?? 0) >= s.referral_max_rewards || s.referral_reward_kobo <= 0;
    const ok = await tx(async (q) => {
      if (skip) {
        await q.query('insert into referral_rewards (referrer_id, friend_id, order_id, amount_kobo) values ($1,$2,$3,0) on conflict do nothing', [d.referrer_id, d.friend_id, d.order_id]);
        return false;
      }
      let couponId: string | null = null;
      let code = '';
      for (let i = 0; i < 6 && !couponId; i++) {
        code = randomCode('THANKS');
        const row = await q.query<{ id: string }>(
          `insert into coupons (code, description, kind, amount_off_kobo, min_subtotal_kobo, max_redemptions, max_per_customer, first_order_only, product_ids, active, source, owner_customer_id, ends_at)
           values ($1,$2,'fixed',$3,0,1,1,false,'{}',true,'reward',$4,$5) on conflict do nothing returning id`,
          [code, 'Your thank-you for sharing Brandit', s.referral_reward_kobo, d.referrer_id, new Date(now.getTime() + s.referral_reward_days * 86_400_000).toISOString()],
        );
        couponId = row[0]?.id ?? null;
      }
      if (!couponId) return false;
      const w = await q.query(`insert into referral_rewards (referrer_id, friend_id, order_id, reward_coupon_id, amount_kobo) values ($1,$2,$3,$4,$5) on conflict do nothing returning id`, [d.referrer_id, d.friend_id, d.order_id, couponId, s.referral_reward_kobo]);
      if (!w.length) throw new Error('already rewarded'); // rolls the coupon back
      await queueMessage(q, {
        toPhone: to,
        lang: referrer.lang === 'pcm' ? 'pcm' : 'en',
        template: 'referral_reward',
        vars: { friend: (friend?.name ?? '').trim().split(/\s+/)[0] || 'A friend', amount: naira(s.referral_reward_kobo), code, link: shareLink(code) },
      });
      await q.query("insert into events (name, props) values ('referral_reward', $1)", [JSON.stringify({ amount_kobo: s.referral_reward_kobo })]);
      return true;
    }).catch((e) => {
      if ((e as Error).message === 'already rewarded') return false;
      throw e;
    });
    if (ok) paid++;
  }
  return paid;
}

export type ReferralStats = { codes: number; friendOrders: number; discountKobo: number; rewards: number; rewardKobo: number; rewardsUsed: number; top: { name: string; friends: number }[] };

export async function referralStats(days = 90, now = new Date()): Promise<ReferralStats> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const codes = await one<{ n: number }>("select count(*)::int as n from coupons where source = 'referral'");
  const used = await one<any>(
    `select count(*)::int as n, coalesce(sum(r.discount_kobo),0)::int as d
       from coupon_redemptions r join coupons c on c.id = r.coupon_id and c.source = 'referral' where r.created_at >= $1`,
    [since],
  );
  const rw = await one<any>(
    `select count(*) filter (where reward_coupon_id is not null)::int as n, coalesce(sum(amount_kobo),0)::int as k,
            count(*) filter (where exists (select 1 from coupon_redemptions r where r.coupon_id = w.reward_coupon_id))::int as used
       from referral_rewards w where created_at >= $1`,
    [since],
  );
  const top = await query<any>(
    `select split_part(coalesce(o.name, 'Customer'), ' ', 1) as name, count(*)::int as friends
       from coupon_redemptions r join coupons c on c.id = r.coupon_id and c.source = 'referral' join customers o on o.id = c.owner_customer_id
      where r.created_at >= $1 group by o.id, o.name order by friends desc limit 5`,
    [since],
  );
  return { codes: codes?.n ?? 0, friendOrders: used?.n ?? 0, discountKobo: used?.d ?? 0, rewards: rw?.n ?? 0, rewardKobo: rw?.k ?? 0, rewardsUsed: rw?.used ?? 0, top };
}
