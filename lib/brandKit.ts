import { query, one } from './db';
import { putFile, deleteFile, getFile } from './storage';
import { processImage, sniffImage, ImageError } from './imageTools';
import { sniffMime } from './inspect';

/*
 * A brand kit is what a business tells us once so it never has to again: the name and tagline, the colours,
 * the fonts and tone, the contact line for printed material, the logo files and the designs it has approved.
 * It is private to the customer. When they order a design from us, a copy of the text and links to the logo files
 * go into the brief, so the designer starts with everything.
 */
export class KitError extends Error {}

export type BrandKit = {
  customer_id: string; display_name: string | null; tagline: string | null; primary_hex: string | null; secondary_hex: string | null; accent_hex: string | null;
  fonts: string | null; tone: string | null; phone_line: string | null; address_line: string | null; website: string | null; notes: string | null; updated_at: string;
};
export type BrandAsset = { id: string; kind: 'logo' | 'design' | 'other'; title: string; mime: string; bytes: number; has_thumb: boolean; source_order_id: string | null; created_at: string };

export const MAX_ASSETS = 20;
export const MAX_ASSET_MB = 15;
export const KIND_LABEL: Record<BrandAsset['kind'], string> = { logo: 'Logo', design: 'Approved design', other: 'Other file' };

const text = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim().slice(0, n) : '') || null;
const block = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, n) : '') || null;

export const normalizeHex = (v: unknown): string | null => {
  const s = String(v ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) return `#${s.split('').map((c) => c + c).join('').toUpperCase()}`;
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toUpperCase()}`;
  return null;
};

/** A website as people type it: "brand.ng" or "https://brand.ng". Anything that is not a web address is refused. */
export function normalizeWebsite(v: unknown): string | null {
  const s = String(v ?? '').trim().slice(0, 120);
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return null;
  const bare = s.replace(/^https?:\/\//i, '');
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(\/\S*)?$/i.test(bare) ? s : null;
}

export async function brandKitFor(customerId: string): Promise<BrandKit | null> {
  return one<BrandKit>('select * from brand_kits where customer_id = $1', [customerId]);
}

export type KitInput = Record<string, unknown>;
export async function saveBrandKit(customerId: string, i: KitInput): Promise<void> {
  const hexes: Record<string, string | null> = {};
  for (const [k, label] of [['primary_hex', 'main'], ['secondary_hex', 'second'], ['accent_hex', 'accent']] as const) {
    const raw = String(i[k] ?? '').trim();
    if (!raw) { hexes[k] = null; continue; }
    const h = normalizeHex(raw);
    if (!h) throw new KitError(`The ${label} colour should look like #0B1F33. Pick it with the colour box, or leave it empty.`);
    hexes[k] = h;
  }
  const website = normalizeWebsite(i.website);
  if (String(i.website ?? '').trim() && !website) throw new KitError('The website should look like brand.ng or https://brand.ng.');
  await query(
    `insert into brand_kits (customer_id, display_name, tagline, primary_hex, secondary_hex, accent_hex, fonts, tone, phone_line, address_line, website, notes, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     on conflict (customer_id) do update set display_name=excluded.display_name, tagline=excluded.tagline, primary_hex=excluded.primary_hex, secondary_hex=excluded.secondary_hex, accent_hex=excluded.accent_hex,
       fonts=excluded.fonts, tone=excluded.tone, phone_line=excluded.phone_line, address_line=excluded.address_line, website=excluded.website, notes=excluded.notes, updated_at=now()`,
    [customerId, text(i.display_name, 80), text(i.tagline, 100), hexes.primary_hex, hexes.secondary_hex, hexes.accent_hex, text(i.fonts, 120), text(i.tone, 160), text(i.phone_line, 100), text(i.address_line, 160), website, block(i.notes, 600)],
  );
}

export async function listAssets(customerId: string): Promise<BrandAsset[]> {
  return query<BrandAsset>(
    'select id, kind, title, mime, bytes, thumb_key is not null as has_thumb, source_order_id, created_at from brand_assets where customer_id = $1 order by created_at desc',
    [customerId],
  );
}

const extOf = (mime: string) => (mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : mime === 'application/pdf' ? 'pdf' : 'webp');

/** A logo or design file. The original is kept as it is, because print needs every pixel. A small preview is made for the screen. */
export async function addAsset(customerId: string, kind: BrandAsset['kind'], title: string, f: { name: string; buf: Buffer }): Promise<BrandAsset> {
  if (!['logo', 'design', 'other'].includes(kind)) throw new KitError('Choose what kind of file this is.');
  const have = (await one<{ n: number }>('select count(*)::int as n from brand_assets where customer_id = $1', [customerId]))!.n;
  if (have >= MAX_ASSETS) throw new KitError(`Your brand kit holds up to ${MAX_ASSETS} files. Remove one first.`);
  if (f.buf.length > MAX_ASSET_MB * 1_000_000) throw new KitError(`“${f.name}” is larger than ${MAX_ASSET_MB} MB. Send a smaller copy.`);
  const mime = sniffImage(f.buf) ?? sniffMime(f.buf);
  if (!mime || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mime)) throw new KitError(`“${f.name}” is not a JPG, PNG, WebP or PDF file.`);

  let thumbKey: string | null = null;
  if (mime !== 'application/pdf') {
    try {
      const p = await processImage(f.buf, f.name, { fullMax: 400, thumbMax: 400, maxBytes: MAX_ASSET_MB * 1_000_000 });
      thumbKey = await putFile(p.thumb, 'webp');
    } catch (e) {
      throw new KitError(e instanceof ImageError ? e.message : `We could not read “${f.name}”.`);
    }
  }
  const key = await putFile(f.buf, extOf(mime));
  const name = text(title, 80) || f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 80) || 'File';
  const row = await one<BrandAsset>(
    `insert into brand_assets (customer_id, kind, title, storage_key, thumb_key, mime, bytes) values ($1,$2,$3,$4,$5,$6,$7)
     returning id, kind, title, mime, bytes, thumb_key is not null as has_thumb, source_order_id, created_at`,
    [customerId, kind, name, key, thumbKey, mime, f.buf.length],
  );
  return row!;
}

/** Keep the stored file until the last record that points at it is gone. */
async function dropIfUnused(key: string | null) {
  if (!key) return;
  const a = await one('select 1 as x from brand_assets where storage_key = $1 or thumb_key = $1 limit 1', [key]);
  const b = await one('select 1 as x from files where storage_key = $1 limit 1', [key]);
  if (!a && !b) await deleteFile(key).catch(() => {});
}

export async function deleteAsset(customerId: string, assetId: string): Promise<boolean> {
  const r = await one<{ storage_key: string; thumb_key: string | null }>('delete from brand_assets where id = $1 and customer_id = $2 returning storage_key, thumb_key', [assetId, customerId]);
  if (!r) return false;
  await dropIfUnused(r.storage_key);
  await dropIfUnused(r.thumb_key);
  return true;
}

/** Save the file from a past order as an approved design: the print file, or the proof the customer approved. */
export async function saveOrderDesign(customerId: string, orderToken: string): Promise<BrandAsset> {
  const o = await one<any>(
    `select o.id, o.code, i.id as item_id, i.artwork_path, i.artwork_file_id, coalesce(i.label, p.name) as name
       from orders o join order_items i on i.order_id = o.id join products p on p.id = i.product_id
      where o.public_token = $1 and o.customer_id = $2 and o.status in ('paid','in_production','delivered') and p.slug <> 'id-cards'`,
    [orderToken, customerId],
  );
  if (!o) throw new KitError('We could not find that order in your account. ID card files are never saved to a brand kit, because they hold people\'s details.');
  const dup = await one('select 1 as x from brand_assets where customer_id = $1 and source_order_id = $2', [customerId, o.id]);
  if (dup) throw new KitError('That design is already in your brand kit.');
  const file = o.artwork_path === 'design'
    ? await one<any>("select f.* from proofs pr join files f on f.id = pr.file_id where pr.order_item_id = $1 and pr.status = 'approved' order by pr.version desc limit 1", [o.item_id])
    : o.artwork_file_id ? await one<any>('select * from files where id = $1', [o.artwork_file_id]) : null;
  if (!file || file.storage_key === 'deleted.bin') throw new KitError('There is no approved file on that order yet.');
  const have = (await one<{ n: number }>('select count(*)::int as n from brand_assets where customer_id = $1', [customerId]))!.n;
  if (have >= MAX_ASSETS) throw new KitError(`Your brand kit holds up to ${MAX_ASSETS} files. Remove one first.`);
  // A copy of the preview picture is made so the kit shows a thumbnail. The file itself is shared, not copied.
  let thumbKey: string | null = null;
  if (file.mime !== 'application/pdf') {
    try { thumbKey = await putFile((await processImage(await getFile(file.storage_key), 'design', { fullMax: 400, thumbMax: 400, maxBytes: 100_000_000 })).thumb, 'webp'); } catch { thumbKey = null; }
  }
  const row = await one<BrandAsset>(
    `insert into brand_assets (customer_id, kind, title, storage_key, thumb_key, mime, bytes, source_order_id) values ($1,'design',$2,$3,$4,$5,$6,$7)
     returning id, kind, title, mime, bytes, thumb_key is not null as has_thumb, source_order_id, created_at`,
    [customerId, `${o.name} (${o.code})`.slice(0, 80), file.storage_key, thumbKey, file.mime, file.bytes, o.id],
  );
  return row!;
}

/** Past orders whose file could be saved, newest first, without those already saved. */
export async function savableOrders(customerId: string) {
  return query<{ token: string; code: string; name: string; delivered: boolean }>(
    `select o.public_token as token, o.code, coalesce(i.label, p.name) as name, o.status = 'delivered' as delivered
       from orders o join order_items i on i.order_id = o.id join products p on p.id = i.product_id
      where o.customer_id = $1 and o.status in ('paid','in_production','delivered') and not p.system and p.slug <> 'id-cards'
        and not exists (select 1 from brand_assets a where a.customer_id = $1 and a.source_order_id = o.id)
      order by o.created_at desc limit 8`,
    [customerId],
  );
}

export async function readAsset(id: string, size: 'thumb' | 'full') {
  const a = await one<{ customer_id: string; storage_key: string; thumb_key: string | null; mime: string; title: string }>('select customer_id, storage_key, thumb_key, mime, title from brand_assets where id = $1', [id]);
  if (!a) return null;
  try {
    if (size === 'thumb' && a.thumb_key) return { owner: a.customer_id, buf: await getFile(a.thumb_key), mime: 'image/webp', title: a.title };
    return { owner: a.customer_id, buf: await getFile(a.storage_key), mime: a.mime, title: a.title };
  } catch { return null; }
}

/** Use a saved file as the artwork of an order, running the same checks as an upload. */
export async function assetBuffer(customerId: string, assetId: string): Promise<{ name: string; type: string; buf: Buffer } | null> {
  const a = await one<{ storage_key: string; mime: string; title: string }>('select storage_key, mime, title from brand_assets where id = $1 and customer_id = $2', [assetId, customerId]);
  if (!a) return null;
  try { return { name: `${a.title}.${extOf(a.mime)}`, type: a.mime, buf: await getFile(a.storage_key) }; } catch { return null; }
}

export type BrandSnapshot = {
  name: string | null; tagline: string | null; colours: string; fonts: string | null; tone: string | null;
  contact: string | null; website: string | null; notes: string | null; assets: { id: string; kind: string; title: string }[];
};

/** What goes into a design brief. Text only: files are fetched by the designer from the job page. */
export async function brandSnapshot(customerId: string): Promise<BrandSnapshot | null> {
  const kit = await brandKitFor(customerId);
  const assets = (await listAssets(customerId)).filter((a) => a.kind !== 'other').slice(0, 10);
  if (!kit && assets.length === 0) return null;
  const colours = [kit?.primary_hex && `main ${kit.primary_hex}`, kit?.secondary_hex && `second ${kit.secondary_hex}`, kit?.accent_hex && `accent ${kit.accent_hex}`].filter(Boolean).join(', ');
  const contact = [kit?.phone_line, kit?.address_line].filter(Boolean).join(' · ') || null;
  return {
    name: kit?.display_name ?? null, tagline: kit?.tagline ?? null, colours, fonts: kit?.fonts ?? null, tone: kit?.tone ?? null,
    contact, website: kit?.website ?? null, notes: kit?.notes ?? null,
    assets: assets.map((a) => ({ id: a.id, kind: a.kind, title: a.title })),
  };
}

/** Remove the whole kit when a customer deletes their account. Returns nothing; stored files go once nothing points at them. */
export async function eraseBrandKit(customerId: string): Promise<string[]> {
  const rows = await query<{ storage_key: string; thumb_key: string | null }>('delete from brand_assets where customer_id = $1 returning storage_key, thumb_key', [customerId]);
  await query('delete from brand_kits where customer_id = $1', [customerId]);
  return rows.flatMap((r) => [r.storage_key, r.thumb_key]).filter((k): k is string => !!k);
}

/** Delete these stored files if no brand asset or order file still uses them. */
export async function dropUnusedFiles(keys: string[]): Promise<void> {
  for (const k of new Set(keys)) await dropIfUnused(k);
}
