import { createHash, randomInt } from 'node:crypto';
import sharp from 'sharp';
import { one, query, tx } from '../db';
import { getSettings } from '../settings';
import type { Settings } from '../settings-defaults';
import { getProduct } from '../catalog';
import { token } from '../password';
import { putFile, getFile, deleteFile } from '../storage';
import { sniffImage } from '../imageTools';
import { limited } from '../ratelimit';
import type { Customer } from '../identity';
import { occasionById, paletteById, PALETTES, type Palette } from '../../content/studio';
import { CATEGORY_MESSAGE } from '../../content/studio-policy';
import { moderateBrief, moderateImage, moderateTextRemote, describeFinding, scanText } from './moderation';
import { unsupportedChars } from './fonts';
import { buildSpec, isSpecError, type Spec } from './specs';
import { allowanceFor, accessFor, priceOf, type Tier } from './config';
import { defaultBrief, missingRequired, normaliseBrief, wordsOf, type Brief } from './prompts';
import { logSketch, recordFlag, sketchState, unlogSketch } from './limits';
import { dominantColours, paletteFromLogo } from './compose';

/*
 * A project is one design job: what the customer typed, the pictures they added, every version made, and what they approved.
 * Every function that takes a customer checks the project belongs to them. Nothing here talks to a picture maker: it only
 * records what to make. worker.ts makes it.
 */
export type Project = {
  id: string; share_token: string; customer_id: string; title: string; tier: Tier | null; status: 'draft' | 'active' | 'approved' | 'archived' | 'purged';
  product_slug: string; size_key: string | null; config: Record<string, string>; quantity: number; width_ft: number | null; height_ft: number | null;
  occasion: string; brief: Brief | Record<string, never>; order_id: string | null; shared_version_id: string | null; liked_version_id: string | null; approved_version_id: string | null; approved_sha256: string | null;
  approved_at: string | null; spelling_confirmed_at: string | null; credit_kobo: number; credit_coupon_id: string | null; extra_rounds: number; vector_paid: boolean; check_paid: boolean;
  paid_kobo: number; paid_at: string | null; from_pack: boolean; finishes: number; consent_at: string | null; last_activity_at: string; delete_after: string | null; created_at: string;
};
export type Version = {
  id: string; project_id: string; parent_id: string | null; kind: 'sketch' | 'concept' | 'draft' | 'revision' | 'final' | 'edit' | 'adapt' | 'tweak'; idx: number; round: number;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'blocked'; free: boolean; seed: number | null; engine: string | null; model: string | null; prompt: string | null; note: string | null;
  layout: { brief?: Brief; paletteId?: string }; payload: Record<string, any>; spec: Spec | null; art_key: string | null; art_w: number | null; art_h: number | null;
  preview_key: string | null; preview_w: number | null; preview_h: number | null; final_key: string | null; final_mime: string | null; final_w: number | null; final_h: number | null; final_bytes: number | null;
  pdf_key: string | null; svg_key: string | null; sha256: string | null; check_result: any; upscale: any; finish_status: 'none' | 'queued' | 'running' | 'done' | 'failed'; finish_error: string | null; finish_attempts: number;
  attempts: number; error: string | null; user_error: string | null; cost_usd_micro: string | number; created_at: string; ready_at: string | null; locked_at: string | null;
};
export type Asset = { id: string; project_id: string; customer_id: string; kind: 'photo' | 'logo' | 'reference' | 'fabric'; title: string; storage_key: string | null; preview_key: string | null; cut_key: string | null; vector_key: string | null; mime: string; bytes: number; width_px: number | null; height_px: number | null; palette: any; moderation: string; created_at: string };

export type Fail = { ok: false; error: string; code?: string; field?: string; extra?: Record<string, unknown> };
export type Ok<T = {}> = { ok: true } & T;

export const PHOTO_MAX = 15_000_000, LOGO_MAX = 8_000_000;

export const audit = (projectId: string | null, actor: string, action: string, detail: Record<string, unknown> = {}) =>
  query('insert into studio_audit (project_id, actor, action, detail) values ($1,$2,$3,$4)', [projectId, actor, action, JSON.stringify(detail)]);

export async function touch(projectId: string, s?: Settings) {
  const days = (s ?? (await getSettings())).studio_keep_days;
  await query("update studio_projects set last_activity_at = now(), delete_after = now() + ($2 || ' days')::interval where id = $1 and status <> 'purged'", [projectId, String(days)]);
}

// ---------- Loading ----------
export const getProject = (id: string) => one<Project>('select * from studio_projects where id = $1', [id]);
export const getProjectByShare = (tok: string) => one<Project>("select * from studio_projects where share_token = $1 and status <> 'purged'", [tok]);
export async function ownProject(c: Pick<Customer, 'id'>, id: string): Promise<Project | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return one<Project>("select * from studio_projects where id = $1 and customer_id = $2 and status <> 'purged'", [id, c.id]);
}
export const listProjects = (customerId: string) =>
  query<Project & { cover_key: string | null; versions: string }>(
    `select p.*, (select preview_key from studio_versions v where v.project_id = p.id and v.status = 'ready' and v.preview_key is not null order by (v.id = p.approved_version_id) desc, v.ready_at desc limit 1) as cover_key,
            (select count(*) from studio_versions v where v.project_id = p.id and v.status = 'ready') as versions
     from studio_projects p where p.customer_id = $1 and p.status <> 'purged' order by p.last_activity_at desc limit 60`,
    [customerId],
  );
export const getVersion = (id: string) => one<Version>('select * from studio_versions where id = $1', [id]);
export const versionsOf = (projectId: string) => query<Version>('select * from studio_versions where project_id = $1 order by created_at, idx', [projectId]);
export const assetsOf = (projectId: string) => query<Asset>('select * from studio_assets where project_id = $1 order by created_at', [projectId]);
export const latestAsset = async (projectId: string, kind: 'photo' | 'logo') => one<Asset>('select * from studio_assets where project_id = $1 and kind = $2 order by created_at desc limit 1', [projectId, kind]);

export const briefOf = (p: Project): Brief => normaliseBrief(p.brief, defaultBrief(p.occasion));

export async function specOf(p: Pick<Project, 'product_slug' | 'size_key' | 'width_ft' | 'height_ft'>, s?: Settings): Promise<Spec | { error: string }> {
  const prod = await getProduct(p.product_slug);
  if (!prod || !prod.active) return { error: 'We could not find that product.' };
  return buildSpec(prod, { sizeKey: p.size_key, widthFt: p.width_ft, heightFt: p.height_ft }, s ?? (await getSettings()));
}

// ---------- Create ----------
export type CreateIn = { productSlug: string; sizeKey?: string | null; widthFt?: number | null; heightFt?: number | null; quantity?: number; config?: Record<string, string>; occasion?: string; orderId?: string | null };

export async function createProject(c: Customer, i: CreateIn): Promise<Ok<{ project: Project }> | Fail> {
  const s = await getSettings();
  const acc = await accessFor(s, c as any);
  if (!acc.ok) return { ok: false, error: acc.message, code: acc.reason };
  if (limited(`studio:create:${c.id}`, 20, 3_600_000)) return { ok: false, error: 'You have started a lot of designs in an hour. Please wait a little and try again.' };
  const prod = await getProduct(i.productSlug);
  if (!prod || !prod.active) return { ok: false, error: 'Choose a product to design for.', field: 'product' };
  const spec = buildSpec(prod, i, s);
  if (isSpecError(spec)) return { ok: false, error: spec.error, field: 'size' };
  const occ = occasionById(i.occasion ?? (prod.slug === 'id-cards' ? 'staff_id' : 'other'));
  if (prod.slug === 'id-cards' && occ.id !== 'staff_id') return { ok: false, error: 'ID cards in Studio are for your own staff only. Choose "Staff ID card".', field: 'occasion' };
  let orderId: string | null = null;
  if (i.orderId) {
    const o = await one<{ id: string; customer_id: string | null; status: string }>('select id, customer_id, status from orders where id = $1', [i.orderId]);
    if (o && o.status === 'draft' && (!o.customer_id || o.customer_id === c.id)) orderId = o.id;
  }
  const config = Object.fromEntries(Object.entries(i.config ?? {}).filter(([k, v]) => typeof v === 'string' && k.length < 40 && v.length < 80)) as Record<string, string>;
  const brief = defaultBrief(occ.id);
  const row = await one<Project>(
    `insert into studio_projects (share_token, customer_id, title, product_slug, size_key, config, quantity, width_ft, height_ft, occasion, brief, order_id, delete_after)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() + ($13 || ' days')::interval) returning *`,
    [token(16), c.id, `${occ.label}`, prod.slug, spec.sizeKey, JSON.stringify(config), Math.max(1, Math.min(100000, Math.trunc(Number(i.quantity) || 1))), spec.widthFt, spec.heightFt, occ.id, JSON.stringify(brief), orderId, String(s.studio_keep_days)],
  );
  await audit(row!.id, `customer:${c.id}`, 'created', { product: prod.slug, size: spec.sizeKey, occasion: occ.id });
  return { ok: true, project: row! };
}

/** Change the product or size. Only before the design is bought, because paid versions are made for one size. */
export async function changeSpec(c: Customer, id: string, i: Omit<CreateIn, 'occasion' | 'orderId'>): Promise<Ok<{ project: Project }> | Fail> {
  const p = await ownProject(c, id);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  if (p.tier) return { ok: false, error: 'This design is already bought for one size. Start a new design for a different size, or ask for the same look on another product.' };
  const prod = await getProduct(i.productSlug);
  if (!prod || !prod.active) return { ok: false, error: 'Choose a product to design for.' };
  const s = await getSettings();
  const spec = buildSpec(prod, i, s);
  if (isSpecError(spec)) return { ok: false, error: spec.error };
  if (prod.slug === 'id-cards' && p.occasion !== 'staff_id') return { ok: false, error: 'ID cards in Studio are for your own staff only. Choose "Staff ID card".' };
  const row = await one<Project>(
    'update studio_projects set product_slug = $2, size_key = $3, width_ft = $4, height_ft = $5, quantity = coalesce($6, quantity) where id = $1 returning *',
    [id, prod.slug, spec.sizeKey, spec.widthFt, spec.heightFt, i.quantity ? Math.max(1, Math.min(100000, Math.trunc(Number(i.quantity)))) : null],
  );
  await touch(id, s);
  return { ok: true, project: row! };
}

// ---------- The brief ----------
export type BriefResult = Ok<{ brief: Brief; warnings: string[] }> | Fail;

export async function saveBrief(c: Customer, id: string, raw: unknown): Promise<BriefResult> {
  const p = await ownProject(c, id);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  const s = await getSettings();
  const acc = await accessFor(s, c as any);
  if (!acc.ok) return { ok: false, error: acc.message, code: acc.reason };
  if (p.status === 'approved') return { ok: false, error: 'This design is approved. Reopen it to change the words.' };
  if (limited(`studio:brief:${c.id}`, 60, 10 * 60_000)) return { ok: false, error: 'Please slow down a little and try again in a minute.' };
  const prev = briefOf(p);
  // The occasion decides which boxes exist, so it can only change before the design is bought.
  const incoming = raw && typeof raw === 'object' ? { ...(raw as object) } : {};
  if (p.tier) (incoming as any).occasion = p.occasion;
  const brief = normaliseBrief(incoming, prev);
  const occ = occasionById(brief.occasion);
  const warnings: string[] = [];

  const words = wordsOf(brief);
  const bad = unsupportedChars(words.join(' ') + ' ' + brief.look);
  if (bad.length) return { ok: false, error: `These characters cannot be printed: ${bad.slice(0, 8).join(' ')}. Remove them or write them in words.`, field: 'lines' };

  const verdict = moderateBrief({ productSlug: p.product_slug, occasion: brief.occasion, lines: Object.entries(brief.lines).map(([k, text]) => ({ id: k, text })), look: brief.look, extra: s.studio_blocklist_extra });
  if (verdict.verdict === 'block') {
    const paused = await recordFlag(s, { customerId: c.id, projectId: id, stage: brief.look && !words.some((w) => scanText(w, { scope: 'words' }).length) ? 'look' : 'words', category: verdict.category ?? 'custom', verdict: 'block', excerpt: verdict.matched });
    return { ok: false, error: verdict.message ?? CATEGORY_MESSAGE.custom, code: paused ? 'paused' : 'blocked', field: 'lines' };
  }
  if (verdict.verdict === 'review') await recordFlag(s, { customerId: c.id, projectId: id, stage: 'words', category: verdict.category ?? 'custom', verdict: 'review', excerpt: verdict.matched });
  // A second opinion on the free-text look and the words, when a moderation key is set.
  const text = [...words, brief.look].filter(Boolean).join('\n');
  if (text.length > 3 && (brief.look !== prev.look || JSON.stringify(brief.lines) !== JSON.stringify(prev.lines))) {
    const remote = await moderateTextRemote(text);
    if (remote.verdict === 'block') {
      const paused = await recordFlag(s, { customerId: c.id, projectId: id, stage: 'words', category: remote.category ?? 'custom', verdict: 'block', excerpt: remote.matched });
      return { ok: false, error: remote.message ?? CATEGORY_MESSAGE.custom, code: paused ? 'paused' : 'blocked' };
    }
  }
  if (brief.qrUrl) {
    const f = scanText(brief.qrUrl, { scope: 'words' });
    if (f.some((x) => x.verdict === 'block')) return { ok: false, error: 'That link cannot be used on a design.', field: 'qrUrl' };
    if (p.product_slug === 'id-cards') brief.qrUrl = '';
  }
  for (const d of occ.lines) if (d.max && (brief.lines[d.id]?.length ?? 0) >= d.max) warnings.push(`"${d.label}" was shortened to ${d.max} characters.`);
  await query('update studio_projects set brief = $2, occasion = $3, title = $4 where id = $1', [id, JSON.stringify(brief), brief.occasion, projectTitle(brief, p.title)]);
  await touch(id, s);
  return { ok: true, brief, warnings };
}

function projectTitle(b: Brief, fallback: string): string {
  const occ = occasionById(b.occasion);
  const first = occ.lines.map((d) => b.lines[d.id]).find((t) => t && t.trim());
  return (first ? first.replace(/\s+/g, ' ').slice(0, 50) : fallback || occ.label).trim();
}

export async function setConsent(c: Customer, id: string): Promise<boolean> {
  const p = await ownProject(c, id);
  if (!p) return false;
  await query('update studio_projects set consent_at = coalesce(consent_at, now()) where id = $1', [id]);
  await audit(id, `customer:${c.id}`, 'consent', {});
  return true;
}

// ---------- Pictures the customer adds ----------
export async function addAsset(c: Customer, id: string, kind: 'photo' | 'logo', f: { name: string; buf: Buffer }): Promise<Ok<{ asset: Asset; palette?: Palette | null }> | Fail> {
  const p = await ownProject(c, id);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  if (p.status === 'approved') return { ok: false, error: 'This design is approved. Reopen it to change the pictures.' };
  if (p.product_slug === 'id-cards' && kind === 'logo' && !p.consent_at) { /* allowed; consent is checked at generation */ }
  if (limited(`studio:upload:${c.id}`, 24, 3_600_000)) return { ok: false, error: 'That is a lot of uploads in an hour. Please try again a little later.' };
  const max = kind === 'photo' ? PHOTO_MAX : LOGO_MAX;
  if (f.buf.length > max) return { ok: false, error: `"${f.name}" is larger than ${Math.round(max / 1_000_000)} MB. Pick a smaller file.` };
  const mime = sniffImage(f.buf);
  if (!mime) return { ok: false, error: `"${f.name}" is not a JPG, PNG or WebP picture. Save it as a JPG or PNG and try again.` };
  let meta;
  try { meta = await sharp(f.buf, { limitInputPixels: 120_000_000 }).rotate().metadata(); } catch { return { ok: false, error: `We could not read "${f.name}". Save it again as a JPG and upload that.` }; }
  const w = meta.width ?? 0, h = meta.height ?? 0;
  const minSide = kind === 'photo' ? 400 : 150;
  if (Math.min(w, h) < minSide) return { ok: false, error: `"${f.name}" is too small (${w} × ${h}). Use a ${kind} at least ${minSide} pixels on each side.` };

  // Store a clean copy with the phone's hidden details (GPS, camera, time) removed and the pixels untouched.
  const rotated = sharp(f.buf, { limitInputPixels: 120_000_000 }).rotate();
  const clean = mime === 'image/jpeg' ? await rotated.jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).toBuffer() : await rotated.png().toBuffer();
  const preview = await sharp(f.buf, { limitInputPixels: 120_000_000 }).rotate().resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();

  const s = await getSettings();
  const look = await moderateImage(preview, 'image/webp');
  if (look.verdict === 'block') {
    await recordFlag(s, { customerId: c.id, projectId: id, stage: 'upload', category: look.category ?? 'custom', verdict: 'block', excerpt: look.matched });
    return { ok: false, error: look.message ?? 'We cannot use that picture. Choose a different one.', code: 'blocked' };
  }

  let palette: Palette | null = null;
  let colours: string[] = [];
  try { colours = await dominantColours(clean, 4); if (kind === 'logo') palette = await paletteFromLogo(clean); } catch { /* optional */ }

  // One photo and one logo per design. A new one replaces the old one.
  const old = await query<Asset>('select * from studio_assets where project_id = $1 and kind = $2', [id, kind]);
  const key = await putFile(clean, mime === 'image/jpeg' ? 'jpg' : 'png');
  const pkey = await putFile(preview, 'webp');
  const row = await one<Asset>(
    `insert into studio_assets (project_id, customer_id, kind, title, storage_key, preview_key, mime, bytes, width_px, height_px, palette, moderation)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [id, c.id, kind, f.name.replace(/[^\w .-]/g, '').slice(0, 80), key, pkey, mime === 'image/jpeg' ? 'image/jpeg' : 'image/png', clean.length, w, h, JSON.stringify({ colours, theme: palette }), look.unchecked ? 'ok' : 'ok'],
  );
  for (const a of old) {
    // Versions made earlier still point at their own copy, so an old file is only removed when nothing uses it.
    const used = await one('select 1 as x from studio_versions where project_id = $1 and (payload->>$2 = $3)', [id, `${kind}_asset`, a.id]);
    if (!used) {
      for (const k of [a.storage_key, a.preview_key, a.cut_key, a.vector_key]) if (k) await deleteFile(k).catch(() => {});
      await query('delete from studio_assets where id = $1', [a.id]);
    }
  }
  await touch(id, s);
  await audit(id, `customer:${c.id}`, `upload_${kind}`, { w, h, bytes: clean.length });
  return { ok: true, asset: row!, palette };
}

export async function removeAsset(c: Customer, id: string, kind: 'photo' | 'logo'): Promise<boolean> {
  const p = await ownProject(c, id);
  if (!p || p.status === 'approved') return false;
  const rows = await query<Asset>('select * from studio_assets where project_id = $1 and kind = $2', [id, kind]);
  for (const a of rows) {
    const used = await one('select 1 as x from studio_versions where project_id = $1 and (payload->>$2 = $3)', [id, `${kind}_asset`, a.id]);
    if (!used) {
      for (const k of [a.storage_key, a.preview_key, a.cut_key, a.vector_key]) if (k) await deleteFile(k).catch(() => {});
      await query('delete from studio_assets where id = $1', [a.id]);
    } else await query("update studio_assets set title = '' where id = $1", [a.id]);
  }
  // Hide it from new versions even if an old version still uses the file.
  await query("update studio_assets set kind = 'reference' where project_id = $1 and kind = $2", [id, kind]);
  await touch(id);
  return true;
}

// ---------- Usage and limits ----------
export type Usage = {
  tier: Tier | null;
  concepts: { used: number; total: number };
  rounds: { used: number; total: number; label: string };
  finals: { used: number; total: number };
  extraProducts: { used: number; total: number };
  finishes: { used: number; total: number };
  canRevise: boolean; canFinal: boolean; canAdapt: boolean; canFinish: boolean; busy: number;
  roundPriceKobo: number;
};

export async function usageOf(p: Project, s?: Settings): Promise<Usage> {
  const st = s ?? (await getSettings());
  const tier = p.tier;
  const a = allowanceFor(tier ?? 'standard', st);
  const rows = await query<{ kind: string; round: number; status: string }>(`select kind, round, status from studio_versions where project_id = $1 and status in ('queued','running','ready')`, [p.id]);
  const count = (k: string[]) => rows.filter((r) => k.includes(r.kind)).length;
  const roundsUsed = tier === 'premium'
    ? new Set(rows.filter((r) => r.kind === 'edit').map((r) => r.round)).size
    : new Set(rows.filter((r) => r.kind === 'revision').map((r) => r.round)).size;
  const roundsTotal = a.rounds + p.extra_rounds;
  const finalsUsed = count(['final']);
  const adaptUsed = count(['adapt']);
  return {
    tier,
    concepts: { used: count(['concept', 'draft']), total: a.concepts },
    rounds: { used: roundsUsed, total: roundsTotal, label: tier === 'premium' ? 'edit rounds' : 'rounds of changes' },
    finals: { used: finalsUsed, total: a.finals },
    extraProducts: { used: adaptUsed, total: a.extraProducts },
    finishes: { used: p.finishes, total: st.studio_finish_limit },
    canRevise: !!tier && roundsUsed < roundsTotal,
    canFinal: tier === 'premium' && finalsUsed < a.finals,
    canAdapt: tier === 'premium' && adaptUsed < a.extraProducts,
    canFinish: p.finishes < st.studio_finish_limit,
    busy: rows.filter((r) => r.status !== 'ready').length,
    roundPriceKobo: priceOf(st, 'round', tier ?? 'standard'),
  };
}

// ---------- Making versions ----------
async function snapshot(p: Project, extra: { brief?: Brief } = {}) {
  const brief = extra.brief ?? briefOf(p);
  const photo = await latestAsset(p.id, 'photo');
  const logo = await latestAsset(p.id, 'logo');
  return { brief, photo, logo, payload: { photo_asset: photo?.id ?? null, logo_asset: logo?.id ?? null } };
}

async function insertVersion(p: Project, v: { kind: Version['kind']; idx: number; round?: number; free?: boolean; seed: number; variation: number; note?: string | null; parent?: string | null; spec: Spec; brief: Brief; payload?: Record<string, unknown>; status?: 'queued' | 'ready'; artKey?: string | null; previewKey?: string | null }): Promise<string> {
  const snap = await snapshot(p, { brief: v.brief });
  const row = await one<{ id: string }>(
    `insert into studio_versions (project_id, parent_id, kind, idx, round, status, free, seed, note, layout, payload, spec, art_key, preview_key, delete_after)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [p.id, v.parent ?? null, v.kind, v.idx, v.round ?? 0, v.status ?? 'queued', !!v.free, v.seed, v.note ?? null,
      JSON.stringify({ brief: v.brief, paletteId: v.brief.palette }), JSON.stringify({ variation: v.variation, ...snap.payload, ...(v.payload ?? {}) }), JSON.stringify(v.spec), v.artKey ?? null, v.previewKey ?? null, p.delete_after],
  );
  return row!.id;
}

const seed = () => randomInt(1, 2_000_000_000);

/** Check everything a request to make pictures needs. */
async function ready(c: Customer | null, p: Project, o: { needTier?: boolean; free?: boolean } = {}): Promise<Ok<{ s: Settings; spec: Spec; brief: Brief }> | Fail> {
  const s = await getSettings();
  if (c) {
    const acc = await accessFor(s, c as any);
    if (!acc.ok) return { ok: false, error: acc.message, code: acc.reason };
  } else if (!s.studio_enabled) return { ok: false, error: 'Brandit Studio is not open yet.', code: 'off' };
  const spec = await specOf(p, s);
  if ('error' in spec) return { ok: false, error: spec.error };
  const brief = briefOf(p);
  const missing = missingRequired(brief);
  if (missing.length) return { ok: false, error: `Fill in: ${missing.join(', ')}.`, code: 'brief', field: 'lines' };
  if (!p.consent_at) return { ok: false, error: 'Please tick the box to confirm before we start.', code: 'consent' };
  // Check the words again at the door. A brief saved before the rules changed must not slip through.
  const v = moderateBrief({ productSlug: p.product_slug, occasion: brief.occasion, lines: Object.entries(brief.lines).map(([k, text]) => ({ id: k, text })), look: brief.look, extra: s.studio_blocklist_extra });
  if (v.verdict === 'block') return { ok: false, error: v.message ?? CATEGORY_MESSAGE.custom, code: 'blocked' };
  if (o.needTier && !p.tier) return { ok: false, error: 'Unlock this design first.', code: 'unlock' };
  if (o.needTier && p.tier === 'standard' && spec.needsPremium) return { ok: false, error: 'This size needs a Premium design.', code: 'premium' };
  void describeFinding;
  return { ok: true, s, spec, brief };
}

/** Free sketches: a small, watermarked picture of the customer's own words and photo on the design, before any payment. */
export async function requestSketch(c: Customer, id: string): Promise<Ok<{ versionId: string; left: number }> | Fail> {
  const p = await ownProject(c, id);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  if (p.tier) return { ok: false, error: 'This design is already unlocked. Use the concepts below.' };
  const r = await ready(c, p, { free: true });
  if (!r.ok) return r;
  if (!c.phone) return { ok: false, error: 'Verify your phone number to get your free sketches. It stops one person using them all.', code: 'phone' };
  if (limited(`studio:sketch:${c.id}`, 6, 60 * 60_000)) return { ok: false, error: 'Please wait a little before asking for another sketch.' };
  const st = await sketchState(r.s, c);
  if (st.resting === 'off') return { ok: false, error: 'Free sketches are not available right now. You can still unlock a design.', code: 'rest' };
  if (st.resting) return { ok: false, error: 'Free sketches are resting for today to keep Studio fair for everyone. Come back tomorrow, or unlock a design now.', code: 'rest' };
  if (st.left <= 0) return { ok: false, error: `You have used your ${st.limit} free sketches for this week. They come back on ${st.nextAt ? new Date(st.nextAt).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' }) : 'their own schedule'}. You can unlock a design now.`, code: 'sketch_limit' };
  const have = await one<{ n: string }>("select count(*) as n from studio_versions where project_id = $1 and kind = 'sketch'", [id]);
  const n = Number(have?.n ?? 0);
  if (n >= r.s.studio_free_per_week) return { ok: false, error: 'You have already made the free sketches for this design. Unlock it to see more.', code: 'sketch_limit' };
  const versionId = await insertVersion(p, { kind: 'sketch', idx: n, free: true, seed: seed(), variation: n, spec: r.spec, brief: r.brief });
  await logSketch(c.id, c.phone, id, versionId);
  await touch(id, r.s);
  const { kick } = await import('./worker');
  kick();
  return { ok: true, versionId, left: st.left - 1 };
}

/** After payment: make the first designs. */
export async function startFirstRound(projectId: string): Promise<Ok<{ made: number }> | Fail> {
  const p = await getProject(projectId);
  if (!p || !p.tier) return { ok: false, error: 'Design not found.' };
  const s = await getSettings();
  const spec = await specOf(p, s);
  if ('error' in spec) return { ok: false, error: spec.error };
  const have = await one<{ n: string }>("select count(*) as n from studio_versions where project_id = $1 and kind in ('concept','draft') and status in ('queued','running','ready')", [projectId]);
  if (Number(have?.n ?? 0) > 0) return { ok: true, made: 0 };
  const a = allowanceFor(p.tier, s);
  const brief = briefOf(p);
  const kind = p.tier === 'premium' ? 'draft' : 'concept';
  let made = 0;
  const liked = p.liked_version_id ? await getVersion(p.liked_version_id) : null;
  for (let i = 0; i < a.concepts; i++) {
    const useLiked = i === 0 && liked;
    await insertVersion(p, { kind, idx: i, seed: useLiked && liked.seed ? liked.seed : seed(), variation: useLiked ? Number(liked.payload?.variation ?? 0) : i, spec, brief });
    made++;
  }
  await audit(projectId, 'system', 'first_round', { kind, made });
  const { kick } = await import('./worker');
  kick();
  return { ok: true, made };
}

export async function chooseLiked(c: Customer, id: string, versionId: string): Promise<boolean> {
  const p = await ownProject(c, id);
  const v = p && (await getVersion(versionId));
  if (!p || !v || v.project_id !== id || v.kind !== 'sketch') return false;
  await query('update studio_projects set liked_version_id = $2 where id = $1', [id, versionId]);
  return true;
}

export async function requestChange(c: Customer, id: string, i: { fromVersionId: string; note: string }): Promise<Ok<{ made: number }> | Fail> {
  const p = await ownProject(c, id);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  if (p.status === 'approved') return { ok: false, error: 'This design is approved. Reopen it to ask for changes.' };
  const r = await ready(c, p, { needTier: true });
  if (!r.ok) return r;
  const from = await getVersion(i.fromVersionId);
  if (!from || from.project_id !== id || from.status !== 'ready') return { ok: false, error: 'Choose the design you want changed.' };
  const note = String(i.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (note.length < 3) return { ok: false, error: 'Tell us what to change, for example "more gold, less busy".', field: 'note' };
  const bad = unsupportedChars(note);
  if (bad.length) return { ok: false, error: `These characters cannot be used: ${bad.slice(0, 6).join(' ')}.` };
  const mv = moderateBrief({ productSlug: p.product_slug, occasion: p.occasion, lines: [], look: note, extra: r.s.studio_blocklist_extra });
  if (mv.verdict === 'block') {
    await recordFlag(r.s, { customerId: c.id, projectId: id, stage: 'look', category: mv.category ?? 'custom', verdict: 'block', excerpt: mv.matched });
    return { ok: false, error: mv.message ?? CATEGORY_MESSAGE.custom, code: 'blocked' };
  }
  const remote = await moderateTextRemote(note);
  if (remote.verdict === 'block') return { ok: false, error: remote.message ?? CATEGORY_MESSAGE.custom, code: 'blocked' };
  if (limited(`studio:change:${c.id}`, 20, 60 * 60_000)) return { ok: false, error: 'Please wait a little before asking for more changes.' };
  const u = await usageOf(p, r.s);
  if (!u.canRevise) return { ok: false, error: `You have used all ${u.rounds.total} ${u.rounds.label}. You can add one more for ${(u.roundPriceKobo / 100).toLocaleString('en-NG')} naira.`, code: 'need_round', extra: { priceKobo: u.roundPriceKobo } };
  const a = allowanceFor(p.tier!, r.s);
  const round = u.rounds.used + 1;
  const kind: Version['kind'] = p.tier === 'premium' ? 'edit' : 'revision';
  const per = p.tier === 'premium' ? 1 : a.perRound;
  const fromSpec = from.spec ?? r.spec;
  for (let k = 0; k < per; k++) {
    await insertVersion(p, { kind, idx: k, round, seed: seed(), variation: Number(from.payload?.variation ?? 0), note, parent: from.id, spec: fromSpec, brief: from.layout?.brief ?? r.brief, payload: { productSlug: from.payload?.productSlug } });
  }
  await touch(id, r.s);
  await audit(id, `customer:${c.id}`, kind === 'edit' ? 'edit_round' : 'revision_round', { round, from: from.id });
  const { kick } = await import('./worker');
  kick();
  return { ok: true, made: per };
}

/** Premium: turn a draft into a premium-quality final. */
export async function requestPremiumFinal(c: Customer, id: string, fromVersionId: string): Promise<Ok<{ versionId: string }> | Fail> {
  const p = await ownProject(c, id);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  if (p.tier !== 'premium') return { ok: false, error: 'Premium finals are part of the Premium design.', code: 'premium' };
  const r = await ready(c, p, { needTier: true });
  if (!r.ok) return r;
  const from = await getVersion(fromVersionId);
  if (!from || from.project_id !== id || from.status !== 'ready') return { ok: false, error: 'Choose the draft you like best.' };
  const u = await usageOf(p, r.s);
  if (!u.canFinal) return { ok: false, error: `You have used both premium finals. Ask for an edit round to change one.`, code: 'no_finals' };
  const versionId = await insertVersion(p, { kind: 'final', idx: u.finals.used, seed: from.seed ?? seed(), variation: Number(from.payload?.variation ?? 0), parent: from.id, spec: from.spec ?? r.spec, brief: from.layout?.brief ?? r.brief });
  await touch(id, r.s);
  const { kick } = await import('./worker');
  kick();
  return { ok: true, versionId };
}

/** Premium: the same look on another product. */
export async function requestAdapt(c: Customer, id: string, i: { fromVersionId: string; productSlug: string; sizeKey?: string | null; widthFt?: number | null; heightFt?: number | null }): Promise<Ok<{ versionId: string }> | Fail> {
  const p = await ownProject(c, id);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  if (p.tier !== 'premium') return { ok: false, error: 'The same look on other products is part of the Premium design.', code: 'premium' };
  const r = await ready(c, p, { needTier: true });
  if (!r.ok) return r;
  const from = await getVersion(i.fromVersionId);
  if (!from || from.project_id !== id || from.status !== 'ready') return { ok: false, error: 'Choose the design to adapt.' };
  const prod = await getProduct(i.productSlug);
  if (!prod || !prod.active) return { ok: false, error: 'Choose a product.' };
  if (prod.slug === 'id-cards') return { ok: false, error: 'ID cards are made from their own Staff ID design.' };
  const spec = buildSpec(prod, i, r.s);
  if (isSpecError(spec)) return { ok: false, error: spec.error };
  const u = await usageOf(p, r.s);
  if (!u.canAdapt) return { ok: false, error: 'You have used the extra products in your Premium design.', code: 'no_adapt' };
  const versionId = await insertVersion(p, {
    kind: 'adapt', idx: u.extraProducts.used, seed: from.seed ?? seed(), variation: Number(from.payload?.variation ?? 0), parent: from.id, spec,
    brief: { ...(from.layout?.brief ?? r.brief) }, payload: { productSlug: prod.slug, sizeKey: spec.sizeKey, widthFt: spec.widthFt, heightFt: spec.heightFt },
  });
  await touch(id, r.s);
  const { kick } = await import('./worker');
  kick();
  return { ok: true, versionId };
}

/** Change the words, fonts or picture shape on a version. Costs nothing: no picture maker is called. */
export async function tweak(c: Customer, id: string, i: { fromVersionId: string; brief: unknown }): Promise<Ok<{ versionId: string }> | Fail> {
  const p = await ownProject(c, id);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  if (p.status === 'approved') return { ok: false, error: 'This design is approved. Reopen it to change the words.' };
  const from = await getVersion(i.fromVersionId);
  if (!from || from.project_id !== id || from.status !== 'ready' || !from.art_key) return { ok: false, error: 'Choose a finished design to change.' };
  if (limited(`studio:tweak:${c.id}`, 40, 60 * 60_000)) return { ok: false, error: 'Please slow down a little and try again in a few minutes.' };
  const saved = await saveBrief(c, id, i.brief);
  if (!saved.ok) return saved;
  const p2 = (await getProject(id))!;
  const spec = from.spec ?? ((await specOf(p2)) as Spec);
  const versionId = await insertVersion(p2, { kind: 'tweak', idx: 0, seed: from.seed ?? 0, variation: Number(from.payload?.variation ?? 0), parent: from.id, spec, brief: saved.brief, artKey: from.art_key, payload: { productSlug: from.payload?.productSlug, art_from: from.id, tier_kind: from.kind } });
  const { processNow } = await import('./worker');
  await processNow(versionId);
  await touch(id);
  return { ok: true, versionId };
}

// ---------- Finish, approve ----------
export async function requestFinish(c: Customer, id: string, versionId: string): Promise<Ok<{}> | Fail> {
  const p = await ownProject(c, id);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  const v = await getVersion(versionId);
  if (!v || v.project_id !== id || v.status !== 'ready' || v.kind === 'sketch') return { ok: false, error: 'Choose a design you have unlocked.' };
  if (!p.tier) return { ok: false, error: 'Unlock this design first.', code: 'unlock' };
  if (v.finish_status === 'done' || v.finish_status === 'queued' || v.finish_status === 'running') return { ok: true };
  const s = await getSettings();
  const u = await usageOf(p, s);
  if (!u.canFinish) return { ok: false, error: 'This design has had a lot of print files made. Please contact us on the Help page.' };
  await query("update studio_versions set finish_status = 'queued', finish_attempts = 0, finish_run_after = now(), finish_error = null where id = $1", [versionId]);
  await query('update studio_projects set finishes = finishes + 1 where id = $1', [id]);
  await touch(id, s);
  const { kick } = await import('./worker');
  kick();
  return { ok: true };
}

export function humanCheckNeeded(p: Pick<Project, 'tier' | 'check_paid'>) {
  return p.tier === 'premium' || p.check_paid;
}

export async function approve(c: Customer, id: string, versionId: string, o: { spellingConfirmed: boolean }): Promise<Ok<{ sha256: string; review: boolean }> | Fail> {
  const p = await ownProject(c, id);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  if (!p.tier) return { ok: false, error: 'Unlock this design first.', code: 'unlock' };
  if (p.status === 'approved') return { ok: false, error: 'This design is already approved.' };
  const v = await getVersion(versionId);
  if (!v || v.project_id !== id || v.status !== 'ready') return { ok: false, error: 'Choose a design to approve.' };
  if (v.finish_status !== 'done' || !v.final_key || !v.sha256) return { ok: false, error: 'The print file is not ready yet. Wait a moment and try again.', code: 'not_finished' };
  const stopped = v.check_result?.status === 'stop';
  if (stopped) return { ok: false, error: v.check_result?.headline ?? 'This design needs a change before it can print.', code: 'check_stop' };
  if (!o.spellingConfirmed) return { ok: false, error: 'Tick the box to confirm every name, date and phone number is spelled right.', code: 'spelling' };
  const s = await getSettings();
  const review = humanCheckNeeded(p);
  await tx(async (q) => {
    await q.query("update studio_versions set locked_at = now() where id = $1", [versionId]);
    await q.query(
      `update studio_projects set status = 'approved', approved_version_id = $2, approved_sha256 = $3, approved_at = now(), spelling_confirmed_at = now(), last_activity_at = now() where id = $1`,
      [id, versionId, v.sha256],
    );
    if (review) await q.query("insert into studio_reviews (project_id, version_id) values ($1,$2)", [id, versionId]);
    await q.query('insert into studio_audit (project_id, actor, action, detail) values ($1,$2,$3,$4)', [id, `customer:${c.id}`, 'approved', JSON.stringify({ version: versionId, sha256: v.sha256, spelling: true, review })]);
  });
  void s;
  if (review) {
    const { notifyReviewRequested } = await import('./notify');
    await notifyReviewRequested(id).catch(() => {});
  } else {
    const { ensureCredit, resumeCredit } = await import('./purchases');
    await resumeCredit(id);
    await ensureCredit(id).catch(() => {});
  }
  return { ok: true, sha256: v.sha256, review };
}

/** Change your mind after approving, before ordering. The old approval stays in the record. */
export async function reopen(c: Customer, id: string): Promise<Ok<{}> | Fail> {
  const p = await ownProject(c, id);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  if (p.status !== 'approved') return { ok: true };
  if (p.order_id) {
    const o = await one<{ status: string }>('select status from orders where id = $1', [p.order_id]);
    if (o && o.status !== 'draft') return { ok: false, error: 'An order has already been placed with this design. Message us if something needs to change.' };
  }
  await tx(async (q) => {
    await q.query("update studio_projects set status = 'active', approved_version_id = null, approved_sha256 = null, approved_at = null, spelling_confirmed_at = null where id = $1", [id]);
    await q.query("update studio_reviews set status = 'changes', note = coalesce(note,'Reopened by the customer'), decided_at = now() where project_id = $1 and status = 'waiting'", [id]);
    await q.query('insert into studio_audit (project_id, actor, action, detail) values ($1,$2,$3,$4)', [id, `customer:${c.id}`, 'reopened', JSON.stringify({ was: p.approved_version_id, sha256: p.approved_sha256 })]);
  });
  const { pauseCredit } = await import('./purchases');
  await pauseCredit(id);
  return { ok: true };
}

export async function reviewState(projectId: string) {
  return one<{ id: string; status: 'waiting' | 'passed' | 'changes'; note: string | null; requested_at: string; decided_at: string | null }>('select id, status, note, requested_at, decided_at from studio_reviews where project_id = $1 order by requested_at desc limit 1', [projectId]);
}

/** May this design go to print? Approved, and checked by a person when a check was bought or included. */
export async function readyToOrder(p: Project): Promise<{ ok: true } | { ok: false; reason: 'not_approved' | 'review_waiting' | 'review_changes' | 'already' }> {
  if (p.status !== 'approved') return { ok: false, reason: 'not_approved' };
  if (humanCheckNeeded(p)) {
    const r = await reviewState(p.id);
    if (!r || r.status === 'waiting') return { ok: false, reason: 'review_waiting' };
    if (r.status === 'changes') return { ok: false, reason: 'review_changes' };
  }
  return { ok: true };
}

// ---------- Sharing ----------
export async function setShared(c: Customer, id: string, versionId: string | null): Promise<boolean> {
  const p = await ownProject(c, id);
  if (!p) return false;
  if (versionId) {
    const v = await getVersion(versionId);
    if (!v || v.project_id !== id || v.status !== 'ready' || !v.preview_key) return false;
  }
  await query('update studio_projects set shared_version_id = $2 where id = $1', [id, versionId]);
  return true;
}

// ---------- Removing ----------
const keysOf = async (projectId: string) => {
  const v = await query<Record<string, string | null>>('select art_key, preview_key, final_key, pdf_key, svg_key from studio_versions where project_id = $1', [projectId]);
  const a = await query<Record<string, string | null>>('select storage_key, preview_key, cut_key, vector_key from studio_assets where project_id = $1', [projectId]);
  return [...v, ...a].flatMap((r) => Object.values(r)).filter((k): k is string => !!k);
};

/** Delete the files, the words and the versions. The record that a design existed (and its payments) stays. */
export async function purgeProject(projectId: string, actor = 'system'): Promise<void> {
  const keys = new Set(await keysOf(projectId));
  for (const k of keys) await deleteFile(k).catch(() => {});
  await tx(async (q) => {
    await q.query('delete from studio_feedback where project_id = $1', [projectId]);
    await q.query('delete from studio_versions where project_id = $1', [projectId]);
    await q.query('delete from studio_assets where project_id = $1', [projectId]);
    await q.query("update studio_projects set status = 'purged', brief = '{}', title = '', shared_version_id = null, liked_version_id = null, approved_version_id = null, delete_after = null where id = $1", [projectId]);
    await q.query('insert into studio_audit (project_id, actor, action, detail) values ($1,$2,$3,$4)', [projectId, actor, 'purged', JSON.stringify({ files: keys.size })]);
  });
}

export async function deleteProject(c: Customer, id: string): Promise<Ok<{}> | Fail> {
  const p = await ownProject(c, id);
  if (!p) return { ok: false, error: 'We could not find that design.' };
  if (p.order_id) {
    const o = await one<{ status: string }>('select status from orders where id = $1', [p.order_id]);
    if (o && !['draft', 'cancelled'].includes(o.status)) return { ok: false, error: 'This design is on a paid order. It is kept until the order is done.' };
  }
  await purgeProject(id, `customer:${c.id}`);
  return { ok: true };
}

/** Called by the sweep: delete what has passed its keep-for date. */
export async function purgeExpired(limit = 25): Promise<number> {
  const rows = await query<{ id: string }>(
    `select p.id from studio_projects p where p.status <> 'purged' and p.delete_after is not null and p.delete_after < now()
       and not exists (select 1 from orders o where o.studio_project_id = p.id and o.status not in ('draft','cancelled') and o.paid_at > now() - interval '60 days' and o.status <> 'delivered')
     order by p.delete_after limit $1`,
    [limit],
  );
  for (const r of rows) await purgeProject(r.id, 'retention');
  return rows.length;
}

export const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
export { PALETTES, paletteById, getFile, unlogSketch };
