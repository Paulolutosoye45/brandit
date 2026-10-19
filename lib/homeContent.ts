import { one, query } from './db';

/*
 * The words and choices on the homepage that the team can change without a developer: the big headline, the line under it,
 * the announcement bar across the top of every page, which products are featured (and in what order), and the Founding
 * counter. Stored as one setting. Anything left blank uses the built-in wording, so an empty editor is a normal homepage.
 */
const KEY = 'home';

export type HomeContent = {
  headline: string;
  subline: string;
  announce: { on: boolean; text: string; link: string };
  featured: string[];
  founding: { on: boolean; limit: number; perk: string };
};
export const HOME_DEFAULT: HomeContent = {
  headline: '', subline: '', announce: { on: false, text: '', link: '' }, featured: [], founding: { on: false, limit: 100, perk: '' },
};

let cache: { at: number; v: HomeContent } | null = null;
export const clearHomeCache = () => { cache = null; };

export function mergeHome(v: unknown): HomeContent {
  const r = (v && typeof v === 'object' ? v : {}) as Partial<HomeContent>;
  const obj = <T,>(x: unknown): Partial<T> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Partial<T>) : {});
  const an = obj<HomeContent['announce']>(r.announce);
  const fo = obj<HomeContent['founding']>(r.founding);
  return {
    headline: typeof r.headline === 'string' ? r.headline : '',
    subline: typeof r.subline === 'string' ? r.subline : '',
    announce: { on: an.on === true, text: typeof an.text === 'string' ? an.text : '', link: typeof an.link === 'string' ? an.link : '' },
    featured: Array.isArray(r.featured) ? r.featured.filter((x): x is string => typeof x === 'string').slice(0, 8) : [],
    founding: { on: fo.on === true, limit: Number.isInteger(fo.limit) && fo.limit! > 0 ? fo.limit! : 100, perk: typeof fo.perk === 'string' ? fo.perk : '' },
  };
}

export async function getHome(): Promise<HomeContent> {
  if (cache && Date.now() - cache.at < 5_000) return cache.v;
  let v = HOME_DEFAULT;
  try {
    const r = await one<{ value: unknown }>('select value from settings where key = $1', [KEY]);
    v = mergeHome(r?.value);
  } catch { /* a database hiccup must not take the homepage down */ }
  cache = { at: Date.now(), v };
  return v;
}

const line = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** A link the bar may point to: one of our own pages ("/products") or a full https address. Nothing else. */
export function safeLink(raw: string): string | null {
  const l = raw.trim();
  if (!l) return '';
  if (/^\/(?!\/)[\w\-./?=&%#]*$/.test(l)) return l;
  if (/^https:\/\/[^\s<>"']+$/.test(l)) return l;
  return null;
}

export type HomeInput = { headline: string; subline: string; announce_on: boolean; announce_text: string; announce_link: string; featured: string[]; founding_on: boolean; founding_limit: string; founding_perk: string };
export async function saveHome(i: HomeInput): Promise<{ ok: true; value: HomeContent } | { ok: false; error: string; field?: string }> {
  const headline = line(i.headline, 70);
  const subline = line(i.subline, 220);
  const text = line(i.announce_text, 140);
  const link = safeLink(i.announce_link);
  if (link === null) return { ok: false, field: 'announce_link', error: 'The link must be one of our pages, like /products, or a full address that starts with https://.' };
  if (i.announce_on && !text) return { ok: false, field: 'announce_text', error: 'Write what the announcement bar should say, or switch it off.' };
  const limit = Math.trunc(Number(i.founding_limit));
  if (i.founding_on && !(limit >= 10 && limit <= 100000)) return { ok: false, field: 'founding_limit', error: 'The Founding places must be a number from 10 to 100,000.' };
  const slugs = (await query<{ slug: string }>('select slug from products where active')).map((r) => r.slug);
  const featured = [...new Set(i.featured)].filter((s) => slugs.includes(s)).slice(0, 8);
  const value: HomeContent = {
    headline, subline, announce: { on: i.announce_on && !!text, text, link: link || '' }, featured,
    founding: { on: i.founding_on, limit: Number.isFinite(limit) && limit > 0 ? limit : 100, perk: line(i.founding_perk, 140) },
  };
  await query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [KEY, JSON.stringify(value)]);
  clearHomeCache();
  return { ok: true, value };
}

/** How many people have ordered and paid: the Founding counter. Each person counts once, however many orders they place. */
export async function foundingCount(): Promise<number> {
  const r = await one<{ n: number }>("select count(distinct customer_id)::int as n from orders where status in ('paid','in_production','delivered') and customer_id is not null");
  return r?.n ?? 0;
}
