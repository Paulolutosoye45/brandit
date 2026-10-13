import { query, one } from './db';
import { putFile, deleteFile, getFile } from './storage';
import { processImage, ImageError } from './imageTools';
import { makeQuote } from './quote';
import { getSettings } from './settings';
import { createDraft, setArtworkPath } from './orders';
import { saveSimpleFile } from './artwork';
import { quantitySteps } from './catalog';
import {
  cleanAnswers, composeWording, isLayout, isPalette, parseFieldLines, slugify, PALETTES,
  type Answers, type Look, type TemplateField,
} from './templateCore';
import { brandSnapshot } from './brandKit';

export class TemplateError extends Error {}

export type Template = {
  id: string; slug: string; title: string; category: string; blurb: string; includes: string;
  product_id: string; product_slug: string; product_name: string;
  quantity: number; size_key: string | null; config: Record<string, string>; width_ft: number | null; height_ft: number | null;
  fields: TemplateField[]; look: Look; purpose: string;
  image_key: string | null; image_thumb_key: string | null; image_mime: string | null;
  active: boolean; sort: number; product_active: boolean;
};

const BASE = `select t.*, p.slug as product_slug, p.name as product_name, p.active as product_active from templates t join products p on p.id = t.product_id`;
const shape = (r: any): Template => ({
  ...r,
  fields: Array.isArray(r.fields) ? r.fields : [],
  look: r.look && r.look.layout ? r.look : { layout: 'flyer', palette: 'ink', lines: [] },
  config: r.config ?? {},
});

/** Templates customers can use: active, and on a product that is on sale. */
export async function listTemplates(opts: { all?: boolean; category?: string } = {}): Promise<Template[]> {
  const where = opts.all ? 'true' : 't.active and p.active';
  const rows = await query<any>(`${BASE} where ${where} ${opts.category ? 'and t.category = $1' : ''} order by t.sort, t.title`, opts.category ? [opts.category] : []);
  return rows.map(shape);
}

export async function getTemplate(slug: string, opts: { all?: boolean } = {}): Promise<Template | null> {
  const r = await one<any>(`${BASE} where t.slug = $1 ${opts.all ? '' : 'and t.active and p.active'}`, [slug]);
  return r ? shape(r) : null;
}
export async function getTemplateById(id: string): Promise<Template | null> {
  const r = await one<any>(`${BASE} where t.id = $1`, [id]);
  return r ? shape(r) : null;
}

export const categoriesOfTemplates = (ts: Pick<Template, 'category'>[]) => [...new Set(ts.map((t) => t.category.trim()).filter(Boolean))];

export const templateImageUrl = (t: Pick<Template, 'id' | 'image_key'>, size: 'thumb' | 'full' = 'thumb') => (t.image_key ? `/api/template-images/${t.id}${size === 'full' ? '?size=full' : ''}` : null);

/** What the customer pays to start from this template: print price and the design fee. Null when it cannot be priced right now. */
export async function templatePrice(t: Template, quantity = t.quantity): Promise<{ printKobo: number; designKobo: number } | null> {
  const q = await makeQuote({ slug: t.product_slug, quantity, config: t.config, sizeKey: t.size_key ?? undefined, widthFt: t.width_ft ?? undefined, heightFt: t.height_ft ?? undefined });
  if (!q.ok) return null;
  const s = await getSettings();
  return { printKobo: q.priceKobo, designKobo: s.design_fee_kobo };
}

/** The quantities a customer may pick for this template. A fixed-size product (a banner, a roll-up) has one. */
export async function quantityChoices(t: Template): Promise<number[]> {
  const steps = await quantitySteps(t.product_id);
  if (steps.length === 0) return [t.quantity];
  return steps.includes(t.quantity) ? steps : [...steps, t.quantity].sort((a, b) => a - b);
}

export type StartInput = { answers: unknown; quantity?: number; colours?: string; files?: { name: string; type: string; buf: Buffer }[]; customerId?: string | null };
export type StartResult = { ok: true; orderId: string } | { ok: false; error: string; field?: string };

/**
 * Turn a filled-in template into a real order: a draft for the right product at the right quantity,
 * set to "design it for me", with the answers as the brief. The customer goes on to checkout.
 */
export async function startFromTemplate(slug: string, i: StartInput): Promise<StartResult> {
  const t = await getTemplate(slug);
  if (!t) return { ok: false, error: 'That template is not available any more. Choose another.' };
  const { answers, missing } = cleanAnswers(t.fields, i.answers);
  if (missing) return { ok: false, error: `Fill in “${missing.label}” so the designer has what they need.`, field: missing.key };

  const qty = Math.trunc(Number(i.quantity ?? t.quantity));
  const choices = await quantityChoices(t);
  if (!choices.includes(qty)) return { ok: false, error: 'Pick one of the quantities shown.', field: 'quantity' };

  const draft = await createDraft({ slug: t.product_slug, quantity: qty, config: t.config, sizeKey: t.size_key ?? undefined, widthFt: t.width_ft ?? undefined, heightFt: t.height_ft ?? undefined });
  if ('error' in draft) return { ok: false, error: draft.error };

  const item = await one<{ id: string }>('select id from order_items where order_id = $1 order by id limit 1', [draft.id]);
  const refIds: string[] = [];
  for (const f of (i.files ?? []).slice(0, 3)) {
    const r = await saveSimpleFile(draft.id, item!.id, 'artwork', f);
    if (r.ok) refIds.push(r.fileId);
  }
  const brand = i.customerId ? await brandSnapshot(i.customerId) : null;
  const colours = (i.colours ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || brand?.colours || '';
  const brief = {
    purpose: t.purpose || t.title,
    wording: composeWording(t.fields, answers) || t.title,
    colours,
    examples: '',
    logo_note: brand ? 'Use the logo and colours from the customer\'s brand kit.' : '',
    reference_file_ids: refIds,
    fix: false,
    template: { slug: t.slug, title: t.title },
    ...(brand ? { brand_kit: brand } : {}),
  };
  await setArtworkPath(draft.id, 'design', brief);
  await query('update orders set template_id = $2 where id = $1', [draft.id, t.id]);
  await query("insert into events (name, props) values ('template_started', $1)", [JSON.stringify({ template: t.slug, quantity: qty })]);
  return { ok: true, orderId: draft.id };
}

// ---------- Staff: make and change templates ----------
export type TemplateInput = {
  title: string; slug?: string; category: string; blurb: string; includes: string; productId: string;
  quantity: string; sizeKey: string; widthFt: string; heightFt: string; purpose: string; fields: string;
  layout: string; palette: string; lines: string;
};

const clean = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

async function validate(i: TemplateInput) {
  const title = clean(i.title, 70);
  if (title.length < 3) throw new TemplateError('Give the template a name customers will recognise, like “Church programme”.');
  const prod = await one<any>('select id, slug, pricing_mode, sizes from products where id = $1 and not system', [i.productId]);
  if (!prod) throw new TemplateError('Choose the product this template prints on.');
  const quantity = Math.trunc(Number(i.quantity));
  if (!(quantity >= 1 && quantity <= 100_000)) throw new TemplateError('Quantity must be a whole number, like 100.');
  let sizeKey: string | null = clean(i.sizeKey, 30) || null;
  if (prod.pricing_mode === 'size') {
    const sizes: { key: string }[] = prod.sizes ?? [];
    if (!sizeKey || !sizes.some((s) => s.key === sizeKey)) sizeKey = sizes[0]?.key ?? null;
  } else sizeKey = null;
  let w: number | null = null, h: number | null = null;
  if (prod.pricing_mode === 'area') {
    w = Number(i.widthFt); h = Number(i.heightFt);
    if (!(w > 0 && w <= 100 && h > 0 && h <= 100)) throw new TemplateError('This product is priced by size. Enter the width and height in feet, like 6 and 3.');
  }
  const fields = parseFieldLines(i.fields);
  if (fields.length === 0) throw new TemplateError('Add at least one question. One per line, like “Church name* | As it should appear”.');
  const layout = isLayout(i.layout) ? i.layout : 'flyer';
  const palette = isPalette(i.palette) ? i.palette : 'ink';
  const lines = String(i.lines ?? '').split(/\r?\n/).map((l) => l.trim().slice(0, 40)).filter(Boolean).slice(0, 8);
  return { title, prod, quantity, sizeKey, w, h, fields, look: { layout, palette, lines } as Look };
}

export async function createTemplate(i: TemplateInput): Promise<Template> {
  const v = await validate(i);
  let slug = slugify(i.slug || v.title) || 'template';
  for (let n = 2; await one('select 1 as x from templates where slug = $1', [slug]); n++) slug = `${slugify(i.slug || v.title).slice(0, 52)}-${n}`;
  const sort = (await one<{ n: number }>('select coalesce(max(sort), -1)::int + 1 as n from templates'))!.n;
  const row = await one<{ id: string }>(
    `insert into templates (slug, title, category, blurb, includes, product_id, quantity, size_key, width_ft, height_ft, fields, look, purpose, active, sort)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,$14) returning id`,
    [slug, v.title, clean(i.category, 40), clean(i.blurb, 200), clean(i.includes, 100), v.prod.id, v.quantity, v.sizeKey, v.w, v.h, JSON.stringify(v.fields), JSON.stringify(v.look), clean(i.purpose, 80) || v.title, sort],
  );
  return (await getTemplateById(row!.id))!;
}

export async function updateTemplate(id: string, i: TemplateInput): Promise<void> {
  if (!(await getTemplateById(id))) throw new TemplateError('We could not find that template.');
  const v = await validate(i);
  await query(
    `update templates set title=$2, category=$3, blurb=$4, includes=$5, product_id=$6, quantity=$7, size_key=$8, width_ft=$9, height_ft=$10, fields=$11, look=$12, purpose=$13 where id=$1`,
    [id, v.title, clean(i.category, 40), clean(i.blurb, 200), clean(i.includes, 100), v.prod.id, v.quantity, v.sizeKey, v.w, v.h, JSON.stringify(v.fields), JSON.stringify(v.look), clean(i.purpose, 80) || v.title],
  );
}

export async function setTemplateActive(id: string, on: boolean) {
  await query('update templates set active = $2 where id = $1', [id, on]);
}

export async function moveTemplate(id: string, dir: 'up' | 'down') {
  const rows = await query<{ id: string }>('select id from templates order by sort, title');
  const i = rows.findIndex((r) => r.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return;
  const ids = rows.map((r) => r.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  for (let k = 0; k < ids.length; k++) await query('update templates set sort = $2 where id = $1', [ids[k], k]);
}

export async function deleteTemplate(id: string) {
  const t = await one<{ image_key: string | null; image_thumb_key: string | null }>('select image_key, image_thumb_key from templates where id = $1', [id]);
  await query('update orders set template_id = null where template_id = $1', [id]);
  await query('delete from templates where id = $1', [id]);
  if (t) for (const k of new Set([t.image_key, t.image_thumb_key])) if (k) await deleteFile(k).catch(() => {});
}

/** One optional preview picture. It replaces the drawn preview. */
export async function setTemplateImage(id: string, f: { name: string; buf: Buffer }) {
  const t = await one<{ image_key: string | null; image_thumb_key: string | null }>('select image_key, image_thumb_key from templates where id = $1', [id]);
  if (!t) throw new TemplateError('We could not find that template.');
  let p;
  try { p = await processImage(f.buf, f.name, { fullMax: 1400, thumbMax: 560, minSide: 200 }); } catch (e) { throw new TemplateError(e instanceof ImageError ? e.message : 'We could not read that picture.'); }
  const full = await putFile(p.full, 'webp');
  const thumb = await putFile(p.thumb, 'webp');
  await query("update templates set image_key = $2, image_thumb_key = $3, image_mime = 'image/webp' where id = $1", [id, full, thumb]);
  for (const k of new Set([t.image_key, t.image_thumb_key])) if (k) await deleteFile(k).catch(() => {});
}
export async function clearTemplateImage(id: string) {
  const t = await one<{ image_key: string | null; image_thumb_key: string | null }>('select image_key, image_thumb_key from templates where id = $1', [id]);
  await query('update templates set image_key = null, image_thumb_key = null, image_mime = null where id = $1', [id]);
  if (t) for (const k of new Set([t.image_key, t.image_thumb_key])) if (k) await deleteFile(k).catch(() => {});
}
export async function readTemplateImage(id: string, size: 'thumb' | 'full') {
  const t = await one<{ image_key: string | null; image_thumb_key: string | null; image_mime: string | null }>('select image_key, image_thumb_key, image_mime from templates where id = $1', [id]);
  if (!t?.image_key) return null;
  try { return { buf: await getFile(size === 'full' ? t.image_key : (t.image_thumb_key ?? t.image_key)), mime: t.image_mime ?? 'image/webp' }; } catch { return null; }
}

/** The products a template may be built on: real products (not the custom-quote placeholder), with their sizes. */
export async function templateProductChoices(): Promise<{ id: string; name: string; pricing_mode: string; sizes: { key: string; label: string }[] }[]> {
  const rows = await query<any>('select id, name, pricing_mode, sizes from products where not system order by sort, name');
  return rows.map((r) => ({ id: r.id, name: r.name, pricing_mode: r.pricing_mode, sizes: Array.isArray(r.sizes) ? r.sizes.map((s: any) => ({ key: String(s.key), label: String(s.label ?? s.key) })) : [] }));
}

export { PALETTES };
export type { Answers };
