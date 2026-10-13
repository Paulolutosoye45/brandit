import { query, one } from './db';
import { findCoupon } from './coupons';
import { normalizeCode } from './couponCore';
import { slugify } from './templateCore';
import { phaseOf, themeOf, validYmd, type Phase } from './campaignCore';
import { lagosParts } from './time';

export class CampaignError extends Error {}

export type Campaign = {
  id: string; slug: string; title: string; headline: string; intro: string; theme: string;
  starts_on: string | null; ends_on: string | null; last_order_note: string; coupon_code: string | null;
  product_slugs: string[]; template_slugs: string[]; show_on_home: boolean; active: boolean; sort: number;
};

const COLS = `id, slug, title, headline, intro, theme, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on,
  last_order_note, coupon_code, product_slugs, template_slugs, show_on_home, active, sort`;

export const lagosToday = (now = new Date()) => lagosParts(now).ymd;

export async function listCampaigns(): Promise<Campaign[]> {
  return query<Campaign>(`select ${COLS} from campaigns order by sort, title`);
}
export async function getCampaign(slug: string): Promise<Campaign | null> {
  return (await one<Campaign>(`select ${COLS} from campaigns where slug = $1`, [slug])) ?? null;
}
export async function getCampaignById(id: string): Promise<Campaign | null> {
  return (await one<Campaign>(`select ${COLS} from campaigns where id = $1`, [id])) ?? null;
}

/** Pages that are live today, in the order staff set. */
export async function liveCampaigns(now = new Date()): Promise<Campaign[]> {
  const today = lagosToday(now);
  return (await listCampaigns()).filter((c) => phaseOf(c, today) === 'live');
}
/** The one page to feature on the home page: the first live page that is switched on for the home page. */
export async function homeCampaign(now = new Date()): Promise<Campaign | null> {
  return (await liveCampaigns(now)).find((c) => c.show_on_home) ?? null;
}
export const phaseNow = (c: Campaign, now = new Date()): Phase => phaseOf(c, lagosToday(now));

export type CampaignInput = {
  title: string; slug?: string; headline: string; intro: string; theme: string; startsOn: string; endsOn: string; note: string;
  couponCode: string; productSlugs: string[]; templateSlugs: string[]; showOnHome: boolean;
};

const clean = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const block = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n) : '');

async function validate(i: CampaignInput) {
  const title = clean(i.title, 60);
  if (title.length < 3) throw new CampaignError('Give the page a short name, like “Wedding season”.');
  const headline = clean(i.headline, 90);
  if (headline.length < 3) throw new CampaignError('Write the big line customers see first, like “Print for the big day”.');
  const startsOn = clean(i.startsOn, 10) || null;
  const endsOn = clean(i.endsOn, 10) || null;
  if (startsOn && !validYmd(startsOn)) throw new CampaignError('Pick the first day from the calendar.');
  if (endsOn && !validYmd(endsOn)) throw new CampaignError('Pick the last day from the calendar.');
  if (startsOn && endsOn && endsOn < startsOn) throw new CampaignError('The last day comes before the first day. Check the dates.');
  let coupon: string | null = null;
  if (clean(i.couponCode, 30)) {
    coupon = normalizeCode(i.couponCode);
    if (!(await findCoupon(coupon))) throw new CampaignError(`There is no coupon “${coupon}”. Create it in Coupons first, then come back.`);
  }
  const products = [...new Set((i.productSlugs ?? []).map((s) => clean(s, 60)).filter(Boolean))].slice(0, 12);
  const templates = [...new Set((i.templateSlugs ?? []).map((s) => clean(s, 60)).filter(Boolean))].slice(0, 12);
  return { title, headline, startsOn, endsOn, coupon, products, templates, theme: themeOf(i.theme), intro: block(i.intro, 500), note: block(i.note, 300) };
}

export async function createCampaign(i: CampaignInput): Promise<Campaign> {
  const v = await validate(i);
  let slug = slugify(i.slug || v.title) || 'season';
  for (let n = 2; await one('select 1 as x from campaigns where slug = $1', [slug]); n++) slug = `${slugify(i.slug || v.title).slice(0, 52)}-${n}`;
  const sort = (await one<{ n: number }>('select coalesce(max(sort), -1)::int + 1 as n from campaigns'))!.n;
  const row = await one<{ id: string }>(
    `insert into campaigns (slug, title, headline, intro, theme, starts_on, ends_on, last_order_note, coupon_code, product_slugs, template_slugs, show_on_home, active, sort)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13) returning id`,
    [slug, v.title, v.headline, v.intro, v.theme, v.startsOn, v.endsOn, v.note, v.coupon, v.products, v.templates, !!i.showOnHome, sort],
  );
  return (await getCampaignById(row!.id))!;
}

export async function updateCampaign(id: string, i: CampaignInput): Promise<void> {
  if (!(await getCampaignById(id))) throw new CampaignError('We could not find that page.');
  const v = await validate(i);
  await query(
    `update campaigns set title=$2, headline=$3, intro=$4, theme=$5, starts_on=$6, ends_on=$7, last_order_note=$8, coupon_code=$9, product_slugs=$10, template_slugs=$11, show_on_home=$12 where id=$1`,
    [id, v.title, v.headline, v.intro, v.theme, v.startsOn, v.endsOn, v.note, v.coupon, v.products, v.templates, !!i.showOnHome],
  );
}

export async function setCampaignActive(id: string, on: boolean) {
  await query('update campaigns set active = $2 where id = $1', [id, on]);
}
export async function moveCampaign(id: string, dir: 'up' | 'down') {
  const rows = await query<{ id: string }>('select id from campaigns order by sort, title');
  const i = rows.findIndex((r) => r.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return;
  const ids = rows.map((r) => r.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  for (let k = 0; k < ids.length; k++) await query('update campaigns set sort = $2 where id = $1', [ids[k], k]);
}
export async function deleteCampaign(id: string) {
  await query('delete from campaigns where id = $1', [id]);
}

export async function campaignViews(days = 30): Promise<Map<string, number>> {
  const rows = await query<{ slug: string; n: number }>(
    `select props->>'slug' as slug, count(*)::int as n from events where name = 'campaign_view' and at > now() - ($1 || ' days')::interval group by 1`,
    [String(days)],
  );
  return new Map(rows.map((r) => [r.slug, r.n]));
}
