import { one, query } from './db';
import { normalizePhone } from './phone';
import { SITE } from './site';

/*
 * The facts about the business that pages quote: the WhatsApp number, phone, email, address, opening hours and how fast
 * we reply. They are typed into the console (Settings, Business details) and live in the database, so changing a number
 * never needs a developer or a redeploy. When nothing has been typed there, the hosting settings
 * NEXT_PUBLIC_WHATSAPP, NEXT_PUBLIC_SUPPORT_EMAIL and NEXT_PUBLIC_BUSINESS_ADDRESS are used, so a site set up before
 * this existed keeps working. We never invent a contact detail: what is not known is simply left out.
 */
const KEY = 'business';

export type BusinessInput = {
  whatsapp: string;       // digits with country code, no plus, for example 2348031234567
  phone: string;          // shown to customers as written
  email: string;
  address: string;
  hours: string;
  reply_within: string;
  legal_reviewed: boolean;
};
export type Business = {
  name: string;
  owner: string;
  whatsapp: string | null;
  whatsappLink: (text?: string) => string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  hours: string;
  replyWithin: string;
  legalReviewed: boolean;
};

const EMPTY: BusinessInput = { whatsapp: '', phone: '', email: '', address: '', hours: '', reply_within: '', legal_reviewed: false };

let cache: { at: number; v: Partial<BusinessInput> } | null = null;
const TTL_MS = 5_000;
export const clearBusinessCache = () => { cache = null; };

async function stored(): Promise<Partial<BusinessInput>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.v;
  let v: Partial<BusinessInput> = {};
  try {
    const r = await one<{ value: Partial<BusinessInput> }>('select value from settings where key = $1', [KEY]);
    v = r?.value && typeof r.value === 'object' ? r.value : {};
  } catch {
    v = {}; // a database hiccup must not take the whole page down: fall back to the hosting settings
  }
  cache = { at: Date.now(), v };
  return v;
}

const digits = (s: string | undefined | null) => String(s ?? '').replace(/\D/g, '');
const text = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

export function makeBusiness(v: Partial<BusinessInput>, env: NodeJS.ProcessEnv = process.env): Business {
  const wa = digits(v.whatsapp) || digits(env.NEXT_PUBLIC_WHATSAPP);
  const reviewedEnv = ['yes', 'true', '1'].includes((env.LEGAL_REVIEWED ?? '').toLowerCase());
  return {
    name: SITE.name,
    owner: SITE.owner,
    whatsapp: wa || null,
    whatsappLink: (t?: string) => (wa ? `https://wa.me/${wa}${t ? `?text=${encodeURIComponent(t)}` : ''}` : null),
    phone: text(v.phone) || null,
    email: text(v.email) || text(env.NEXT_PUBLIC_SUPPORT_EMAIL) || null,
    address: text(v.address) || text(env.NEXT_PUBLIC_BUSINESS_ADDRESS) || null,
    hours: text(v.hours) || SITE.hours,
    replyWithin: text(v.reply_within) || SITE.replyWithin,
    legalReviewed: v.legal_reviewed === true || reviewedEnv,
  };
}

/** The business details, for any server page. Cheap: the stored values are kept for a few seconds. */
export async function getBusiness(): Promise<Business> {
  return makeBusiness(await stored());
}

/** What the console form shows: the typed values only (not the fallbacks), so saving never copies a hosting value into the database by accident. */
export async function businessForm(): Promise<BusinessInput> {
  return { ...EMPTY, ...(await stored()) };
}

export type SaveResult = { ok: true; value: BusinessInput } | { ok: false; error: string; field: keyof BusinessInput };

/** Check what the team typed. Pure, so it can be tested without a database. */
export function checkBusiness(i: Partial<BusinessInput>): SaveResult {
  const clean = (s: unknown, n: number) => text(s).replace(/\s+/g, ' ').slice(0, n);
  let whatsapp = '';
  const rawWa = text(i.whatsapp);
  if (rawWa) {
    const ng = normalizePhone(rawWa);
    // A Nigerian number is turned into the international form. Any other number must already start with its country code.
    const d = ng ? ng.slice(1) : digits(rawWa);
    if (!/^\d{10,15}$/.test(d) || (!ng && rawWa.replace(/[^\d+]/g, '').startsWith('0'))) return { ok: false, field: 'whatsapp', error: 'Enter the WhatsApp number like 0803 123 4567, or with its country code, like +234 803 123 4567.' };
    whatsapp = d;
  }
  const phone = clean(i.phone, 40);
  if (phone && !/^[+\d][\d\s()+-]{6,}$/.test(phone)) return { ok: false, field: 'phone', error: 'Enter the phone number using digits, spaces and a leading + only.' };
  const email = clean(i.email, 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, field: 'email', error: 'Enter a full email address, like hello@thebrandit.ng.' };
  const hours = clean(i.hours, 120);
  const reply = clean(i.reply_within, 60);
  return { ok: true, value: { whatsapp, phone, email, address: clean(i.address, 240), hours, reply_within: reply, legal_reviewed: i.legal_reviewed === true } };
}

export async function saveBusiness(i: Partial<BusinessInput>): Promise<SaveResult> {
  const r = checkBusiness(i);
  if (!r.ok) return r;
  await query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [KEY, JSON.stringify(r.value)]);
  clearBusinessCache();
  return r;
}

/** Same shape the pages used before, so a page changes one line: `const c = await getContact()`. */
export const getContact = getBusiness;
