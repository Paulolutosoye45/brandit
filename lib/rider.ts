import { query, one, tx } from './db';
import { token } from './password';
import { appUrl, flushMessages, queueMessage } from './messages';
import { completeWithCode, JobError } from './jobs';
import { effectiveWindow, windowText, type DeliveryWindow } from './windows';
import { getSettings } from './settings';
import { normalizePhone } from './phone';

/*
 * The rider's page. Dispatch sends the rider a private link. On it the rider can start the trip, share their position
 * while the trip lasts, tell the customer they are close, and finish the delivery with the customer's four-digit code.
 *
 * Privacy: a position is kept only while the order is out for delivery, only the latest one, and it is erased the moment
 * the order is delivered. The customer sees it as a link to a map, not as a live feed.
 */
export const CODE_TRIES = 5;
export const LOCK_MINUTES = 15;
export const PING_MIN_SECONDS = 10;
export const LIVE_FOR_MINUTES = 15;

export const riderUrl = (tok: string) => `${appUrl()}/rider/${tok}`;
export const newRiderToken = () => token(24);
export const validRiderToken = (t: string) => /^[A-Za-z0-9_-]{24}$/.test(t);

/** WhatsApp link that opens a chat with the rider and the private link ready to send. Null when the number is not usable. */
export function riderWhatsAppLink(phone: string | null | undefined, url: string, code: string): string | null {
  const p = phone ? normalizePhone(phone) : null;
  if (!p) return null;
  return `https://wa.me/${p.replace(/^\+/, '')}?text=${encodeURIComponent(`Brandit delivery ${code}. Open this link on your phone to start the trip: ${url}`)}`;
}

export type Pos = { lat: number; lng: number; accuracy?: number | null };
export function validPos(p: any): p is Pos {
  const lat = Number(p?.lat), lng = Number(p?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}
export const mapLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat.toFixed(5)},${lng.toFixed(5)}`;

type Row = Record<string, any>;
async function load(tok: string): Promise<Row | null> {
  if (!validRiderToken(tok)) return null;
  return (await one<Row>(
    `select d.*, o.id as order_id, o.code, o.public_token, o.pickup, o.address, o.area, o.speed, o.delivery_window, o.delivery_code, o.plain_pack, o.delivered_at as order_delivered_at,
            j.id as job_id, j.stage, coalesce(c.name, '') as cname, coalesce(c.whatsapp_phone, c.phone) as cphone,
            (select coalesce(i.label, p.name) || ' × ' || i.quantity from order_items i join products p on p.id = i.product_id where i.order_id = o.id order by i.id limit 1) as summary
       from deliveries d join orders o on o.id = d.order_id left join jobs j on j.order_id = o.id left join customers c on c.id = o.customer_id
      where d.rider_token = $1`,
    [tok],
  )) ?? null;
}

export type RiderView =
  | { state: 'missing' }
  | { state: 'waiting'; code: string }
  | { state: 'done'; code: string }
  | {
      state: 'active'; code: string; summary: string; customer: string; phone: string | null; addressLine: string; area: string; window: string | null;
      plainPack: boolean; started: boolean; nearby: boolean; lockedUntil: string | null; triesLeft: number;
    };

export async function riderView(tok: string, now = new Date()): Promise<RiderView> {
  const r = await load(tok);
  if (!r || r.pickup) return { state: 'missing' };
  if (r.stage === 'delivered' || r.order_delivered_at) return { state: 'done', code: r.code };
  if (r.stage !== 'out_for_delivery') return { state: 'waiting', code: r.code };
  const s = await getSettings();
  const addr = r.address ?? {};
  const win = effectiveWindow(r.delivery_window, { speed: r.speed, pickup: r.pickup, enabled: s.windows_enabled });
  const locked = r.code_locked_until && new Date(r.code_locked_until) > now ? new Date(r.code_locked_until).toISOString() : null;
  return {
    state: 'active', code: r.code, summary: r.summary ?? 'Parcel',
    customer: String(r.cname).split(' ')[0] || 'Customer', phone: r.cphone ?? null,
    addressLine: String(addr.line1 ?? ''), area: String(addr.area ?? r.area ?? ''),
    window: win ? windowText(win) : null, plainPack: !!r.plain_pack,
    started: !!r.started_at, nearby: !!r.nearby_at, lockedUntil: locked, triesLeft: Math.max(0, CODE_TRIES - (r.code_attempts ?? 0)),
  };
}

export type Result = { ok: true; message?: string } | { ok: false; error: string };

export async function startTrip(tok: string): Promise<Result> {
  const r = await load(tok);
  if (!r || r.stage !== 'out_for_delivery') return { ok: false, error: 'This delivery is not ready to start yet.' };
  await query('update deliveries set started_at = coalesce(started_at, now()) where id = $1', [r.id]);
  return { ok: true };
}

export async function recordPing(tok: string, p: unknown, now = new Date()): Promise<Result> {
  const r = await load(tok);
  if (!r || r.stage !== 'out_for_delivery' || !r.started_at) return { ok: false, error: 'Sharing is off.' };
  if (!validPos(p)) return { ok: false, error: 'That position does not look right.' };
  if (r.last_ping_at && now.getTime() - new Date(r.last_ping_at).getTime() < PING_MIN_SECONDS * 1000) return { ok: true }; // too soon; fine, the last one stands
  const acc = (p as Pos).accuracy != null && Number.isFinite(Number((p as Pos).accuracy)) ? Math.min(Math.max(0, Number((p as Pos).accuracy)), 100_000) : null;
  await query('update deliveries set last_lat = $2, last_lng = $3, last_accuracy_m = $4, last_ping_at = $5 where id = $1', [r.id, (p as Pos).lat, (p as Pos).lng, acc, now.toISOString()]);
  return { ok: true };
}

/** "I am close": tell the customer once, with their code ready. */
export async function markNearby(tok: string): Promise<Result> {
  const r = await load(tok);
  if (!r || r.stage !== 'out_for_delivery') return { ok: false, error: 'This delivery is not on the road.' };
  const first = await tx(async (q) => {
    const done = await q.query('update deliveries set nearby_at = now(), started_at = coalesce(started_at, now()) where id = $1 and nearby_at is null returning id', [r.id]);
    if (!done.length) return false;
    await queueMessage(q, { orderId: r.order_id, template: 'rider_nearby', vars: { rider: String(r.rider_name ?? 'Your rider').split(' ')[0], delivery_code: String(r.delivery_code ?? ''), link: `${appUrl()}/track/${r.public_token}` } });
    return true;
  });
  if (first) await flushMessages().catch(() => {});
  return { ok: true, message: first ? 'The customer has been told you are close.' : 'The customer already knows you are close.' };
}

/** The customer reads the four-digit code. Five wrong tries lock the page for fifteen minutes. */
export async function submitCode(tok: string, code: string, now = new Date()): Promise<Result> {
  const r = await load(tok);
  if (!r || r.stage !== 'out_for_delivery') return { ok: false, error: 'This delivery is not on the road.' };
  if (r.code_locked_until && new Date(r.code_locked_until) > now) {
    const mins = Math.max(1, Math.ceil((new Date(r.code_locked_until).getTime() - now.getTime()) / 60_000));
    return { ok: false, error: `Too many wrong codes. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or call dispatch.` };
  }
  const entered = String(code ?? '').replace(/\D/g, '');
  if (entered.length !== 4) return { ok: false, error: 'Enter the four digits the customer reads to you.' };
  try {
    await completeWithCode(r.job_id, entered);
  } catch (e) {
    if (!(e instanceof JobError)) throw e;
    const tries = (r.code_attempts ?? 0) + 1;
    if (tries >= CODE_TRIES) {
      await query('update deliveries set code_attempts = 0, code_locked_until = $2 where id = $1', [r.id, new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString()]);
      return { ok: false, error: `That code is not right. The page is locked for ${LOCK_MINUTES} minutes. Call dispatch if the customer is waiting.` };
    }
    await query('update deliveries set code_attempts = $2 where id = $1', [r.id, tries]);
    return { ok: false, error: `That code does not match. ${CODE_TRIES - tries} ${CODE_TRIES - tries === 1 ? 'try' : 'tries'} left. Ask the customer to read it again.` };
  }
  await query('update deliveries set code_attempts = 0, code_locked_until = null where id = $1', [r.id]);
  return { ok: true, message: 'Delivered. Thank you!' };
}

/** What the customer's tracking page may show about the rider right now. */
export async function liveFor(orderId: string, now = new Date()): Promise<{ updatedAt: string; mapUrl: string } | null> {
  const d = await one<Row>('select last_lat, last_lng, last_ping_at, started_at from deliveries where order_id = $1', [orderId]);
  if (!d?.started_at || d.last_lat == null || d.last_lng == null || !d.last_ping_at) return null;
  if (now.getTime() - new Date(d.last_ping_at).getTime() > LIVE_FOR_MINUTES * 60_000) return null;
  return { updatedAt: new Date(d.last_ping_at).toISOString(), mapUrl: mapLink(d.last_lat, d.last_lng) };
}

/**
 * Erase positions that no longer have a purpose: every delivered order's, and any older than a day.
 * (Delivering also erases it at once; this is the safety net.)
 */
export async function cleanupRiderData(now = new Date()): Promise<number> {
  const r = await query(
    `update deliveries set last_lat = null, last_lng = null, last_accuracy_m = null, last_ping_at = null
      where (last_lat is not null or last_lng is not null)
        and (delivered_at is not null or last_ping_at is null or last_ping_at < $1) returning id`,
    [new Date(now.getTime() - 24 * 3_600_000).toISOString()],
  );
  return r.length;
}
