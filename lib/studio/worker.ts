import QR from 'qrcode';
import sharp from 'sharp';
import { one, query } from '../db';
import { getSettings } from '../settings';
import type { Settings } from '../settings-defaults';
import { getProduct } from '../catalog';
import { putFile, getFile, deleteFile } from '../storage';
import { paletteById, type Palette } from '../../content/studio';
import { buildLayout, refCanvas, type LayoutOut } from './layout';
import { lumaMap, renderPdf, renderPreview, renderRaster, renderSvg, sanitiseSvg } from './compose';
import { generateArt, cutOutPhoto, upscaleTo, vectoriseArt } from './engine';
import { buildArt, layoutLines, type Brief } from './prompts';
import { presetFor, type Spec } from './specs';
import { checkStudio } from './check';
import { EngineError, PausedError } from './providers/types';
import { moderateImage } from './moderation';
import { recordFlag, unlogSketch } from './limits';
import { audit, getProject, sha256, type Asset, type Project, type Version } from './projects';

/*
 * The studio's job runner. There is no separate worker service: after anything is queued, kick() starts a drain loop in this
 * server, the project page polls while work is waiting (which also kicks), and the five-minute sweep recovers anything a
 * restart interrupted. Every job is claimed with one atomic update, so two servers never make the same picture.
 */
const MAX = () => Math.max(1, Math.min(6, Number(process.env.STUDIO_CONCURRENCY ?? 2)));
const g = globalThis as unknown as { __studio_running?: number; __studio_draining?: boolean };
const running = () => (g.__studio_running ??= 0);

export function kick() {
  setImmediate(() => { drain().catch((e) => console.error('[brandit] studio drain failed:', e?.message ?? e)); });
}

type Job = { type: 'generate' | 'finish' | 'vector'; v: Version };

async function claim(): Promise<Job | null> {
  const gen = await one<Version>(
    `update studio_versions set status = 'running', locked_at = now(), attempts = attempts + 1
     where id = (select id from studio_versions where status = 'queued' and run_after <= now() order by free, run_after limit 1) and status = 'queued' returning *`,
  );
  if (gen) return { type: 'generate', v: gen };
  const fin = await one<Version>(
    `update studio_versions set finish_status = 'running', finish_locked_at = now(), finish_attempts = finish_attempts + 1
     where id = (select id from studio_versions where finish_status = 'queued' and finish_run_after <= now() and status = 'ready' order by finish_run_after limit 1) and finish_status = 'queued' returning *`,
  );
  if (fin) return { type: 'finish', v: fin };
  const vec = await one<Version>(
    `update studio_versions set payload = jsonb_set(jsonb_set(payload, '{vector}', '"running"'), '{vector_at}', to_jsonb(now()::text))
     where id = (select id from studio_versions where status = 'ready' and payload->>'vector' = 'queued' limit 1) and payload->>'vector' = 'queued' returning *`,
  );
  if (vec) return { type: 'vector', v: vec };
  return null;
}

export async function drain(): Promise<number> {
  let started = 0;
  while (running() < MAX()) {
    const job = await claim();
    if (!job) break;
    started++;
    g.__studio_running = running() + 1;
    run(job)
      .catch((e) => console.error(`[brandit] studio job ${job.type} ${job.v.id} crashed: ${e?.stack ?? e}`))
      .finally(() => { g.__studio_running = Math.max(0, running() - 1); kick(); });
  }
  return started;
}

/** Wait until the queue is empty. For tests and scripts. */
export async function drainAll(timeoutMs = 120_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await drain();
    const left = await one<{ n: string }>(`select count(*) as n from studio_versions where status in ('queued','running') or finish_status in ('queued','running') or payload->>'vector' in ('queued','running')`);
    if (Number(left?.n ?? 0) === 0 && running() === 0) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error('Studio queue did not finish in time');
}

async function run(job: Job) {
  if (job.type === 'generate') return generateJob(job.v);
  if (job.type === 'finish') return finishJob(job.v);
  return vectorJob(job.v);
}

/** Jobs a restart left half done go back in the queue. */
export async function recoverStale(): Promise<number> {
  const a = await query("update studio_versions set status = 'queued', run_after = now() where status = 'running' and locked_at < now() - interval '8 minutes' returning id");
  const b = await query("update studio_versions set finish_status = 'queued', finish_run_after = now() where finish_status = 'running' and finish_locked_at < now() - interval '15 minutes' returning id");
  const c = await query(`update studio_versions set payload = jsonb_set(payload, '{vector}', '"queued"') where payload->>'vector' = 'running' and (payload->>'vector_at')::timestamptz < now() - interval '10 minutes' returning id`);
  const n = a.length + b.length + c.length;
  const waiting = await one<{ n: string }>(`select count(*) as n from studio_versions where (status = 'queued' and run_after <= now()) or (finish_status = 'queued' and finish_run_after <= now()) or payload->>'vector' = 'queued'`);
  if (n || Number(waiting?.n ?? 0) > 0) kick();
  return n;
}

// ---------- Building a scene ----------
export type Scene = { layout: LayoutOut; palette: Palette; photo: Buffer | null; photoCut: Buffer | null; logo: Buffer | null; photoAsset: Asset | null; logoAsset: Asset | null; brief: Brief; spec: Spec; ref: { w: number; h: number }; notes: string[] };

export function resolvePalette(brief: Brief, logo: Asset | null): Palette {
  if (brief.palette === 'logo' && logo?.palette?.theme) return logo.palette.theme as Palette;
  return paletteById(brief.palette === 'logo' ? 'royal-gold' : brief.palette);
}

async function loadAsset(id: string | null | undefined): Promise<Asset | null> {
  if (!id) return null;
  return one<Asset>('select * from studio_assets where id = $1', [id]);
}

export async function buildScene(v: Version, art: Buffer | null, s: Settings, o: { cut?: boolean } = {}): Promise<Scene> {
  const brief = v.layout.brief as Brief;
  const spec = v.spec as Spec;
  const preset = presetFor(spec);
  const ref = refCanvas(spec.printWIn, spec.printHIn);
  const photoAsset = await loadAsset(v.payload?.photo_asset);
  const logoAsset = await loadAsset(v.payload?.logo_asset);
  const photo = photoAsset?.storage_key ? await getFile(photoAsset.storage_key).catch(() => null) : null;
  const logo = logoAsset?.storage_key ? await getFile(logoAsset.storage_key).catch(() => null) : null;
  const notes: string[] = [];
  let choices = { ...brief.choices };
  let photoCut: Buffer | null = null;
  if (photo && photoAsset && choices.photoShape === 'cutout') {
    if (photoAsset.cut_key) photoCut = await getFile(photoAsset.cut_key).catch(() => null);
    if (!photoCut && o.cut !== false) {
      try {
        const r = await cutOutPhoto(photo, { projectId: v.project_id, versionId: v.id }, s);
        photoCut = r.png;
        const k = await putFile(r.png, 'png');
        await query('update studio_assets set cut_key = $2 where id = $1', [photoAsset.id, k]);
      } catch (e) {
        notes.push('The cut-out could not be made, so the photo is shown in a rounded frame.');
        console.error(`[brandit] studio cut-out failed: ${(e as Error)?.message ?? e}`);
      }
    }
    if (!photoCut) choices = { ...choices, photoShape: 'rounded' };
  }
  const palette = resolvePalette(brief, logoAsset);
  const useQr = !!brief.qrUrl && preset !== 'id';
  const qr = useQr ? (() => { const q = QR.create(brief.qrUrl, { errorCorrectionLevel: 'M' }); const n = q.modules.size; return { modules: Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => !!q.modules.get(r, c))) }; })() : null;
  const luma = await lumaMap(art, ref.w, ref.h);
  const layout = buildLayout({ w: ref.w, h: ref.h, preset, lines: layoutLines(brief), palette, choices, hasPhoto: !!photo, hasLogo: !!logo, qr, safePct: s.studio_safe_margin_pct, lumaAt: luma });
  return { layout, palette, photo, photoCut, logo, photoAsset, logoAsset, brief, spec, ref, notes: [...notes, ...layout.notes] };
}

const chainFor = (v: Version, s: Settings): string[] => (v.kind === 'sketch' ? s.studio_chain_sketch : v.kind === 'final' || v.kind === 'edit' ? s.studio_chain_premium : s.studio_chain_standard);

const smallJpeg = (buf: Buffer) => sharp(buf, { limitInputPixels: 300_000_000 }).resize({ width: 768, height: 768, fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();

// ---------- Generating ----------
async function generateJob(v: Version) {
  const s = await getSettings();
  const p = await getProject(v.project_id);
  if (!p || p.status === 'purged') { await query("update studio_versions set status = 'failed', error = 'project gone' where id = $1", [v.id]); return; }
  const spec = v.spec as Spec;
  const brief = v.layout.brief as Brief;
  try {
    let art: Buffer | null = null;
    let artKey: string | null = v.art_key;
    let aw = v.art_w, ah = v.art_h;
    let engine = v.engine, model = v.model, prompt = v.prompt;

    // Reuse the parent's picture when no new picture is needed: a words-only change, or the same look on a similar shape.
    let reuse = v.kind === 'tweak' && !!v.art_key;
    if (v.kind === 'adapt' && v.parent_id) {
      const parent = await one<Version>('select * from studio_versions where id = $1', [v.parent_id]);
      if (parent?.art_key && parent.spec) {
        const r = spec.printWIn / spec.printHIn / (parent.spec.printWIn / parent.spec.printHIn);
        if (r >= 0.8 && r <= 1.25) { reuse = true; artKey = parent.art_key; aw = parent.art_w; ah = parent.art_h; engine = parent.engine; model = parent.model; }
      }
    }
    if (reuse && artKey) art = await getFile(artKey);
    else {
      const logoAsset = await loadAsset(v.payload?.logo_asset);
      const input = buildArt({ brief, spec, variation: Number(v.payload?.variation ?? 0), note: v.note ?? undefined, palette: resolvePalette(brief, logoAsset), hasPhoto: !!v.payload?.photo_asset, hasLogo: !!v.payload?.logo_asset, seed: (v.seed ?? 1) + (v.attempts > 1 ? v.attempts * 7919 : 0), sketch: v.kind === 'sketch' });
      const gen = await generateArt(input, chainFor(v, s), { projectId: v.project_id, versionId: v.id, free: v.free }, s);
      art = gen.image;
      aw = gen.w; ah = gen.h; engine = gen.engine; model = gen.model; prompt = input.prompt;
      // Look at the result before anyone else does.
      const seen = await moderateImage(await smallJpeg(art), 'image/jpeg');
      if (seen.verdict === 'block') {
        await recordFlag(s, { customerId: null, projectId: v.project_id, versionId: v.id, stage: 'output', category: seen.category ?? 'custom', verdict: 'block', excerpt: seen.matched });
        if (v.attempts < 3) { await query("update studio_versions set status = 'queued', run_after = now(), error = $2 where id = $1", [v.id, `output blocked: ${seen.matched}`]); kick(); return; }
        await query("update studio_versions set status = 'blocked', error = $2, user_error = 'We could not make a safe picture from this request. Try describing the look differently.' where id = $1", [v.id, `output blocked: ${seen.matched}`]);
        if (v.free) await unlogSketch(v.id);
        await afterFailure(v, p);
        return;
      }
      if (v.kind !== 'sketch') artKey = await putFile(art, 'png');
    }

    const scene = await buildScene({ ...v, art_key: artKey } as Version, art, s);
    const long = v.kind === 'sketch' ? 760 : 1200;
    const prev = await renderPreview({ layout: scene.layout, palette: scene.palette, art, photo: scene.photo, photoCut: scene.photoCut, logo: scene.logo, watermark: v.kind === 'sketch', round: spec.shape === 'round', longSide: long, refW: scene.ref.w, refH: scene.ref.h });
    const previewKey = await putFile(prev.buf, 'webp');
    await query(
      `update studio_versions set status = 'ready', art_key = $2, art_w = $3, art_h = $4, preview_key = $5, preview_w = $6, preview_h = $7, engine = $8, model = $9, prompt = $10, ready_at = now(), error = null, user_error = null,
         payload = payload || $11::jsonb where id = $1`,
      [v.id, artKey, aw, ah, previewKey, prev.w, prev.h, engine, model, prompt, JSON.stringify({ notes: scene.notes, clipped: scene.layout.clipped, fallbackFont: scene.layout.fallbackFont })],
    );
    await afterReady(v, p);
  } catch (e) {
    await failGenerate(v, p, e);
  }
}

async function failGenerate(v: Version, p: Project, e: unknown) {
  const msg = (e as Error)?.message ?? String(e);
  console.error(`[brandit] studio generate ${v.id} (${v.kind}) failed: ${msg}`);
  if (e instanceof PausedError) {
    if (v.free) {
      await query("update studio_versions set status = 'failed', error = $2, user_error = $3 where id = $1", [v.id, msg, 'Free sketches are resting right now. Nothing was used from your allowance. Try again later, or unlock a design.']);
      await unlogSketch(v.id);
      return;
    }
    // Paid work waits for the budget or the switch, and the customer is told it is queued.
    await query("update studio_versions set status = 'queued', run_after = now() + interval '10 minutes', error = $2 where id = $1", [v.id, msg]);
    return;
  }
  const retryable = !(e instanceof EngineError) || e.retryable;
  if (retryable && v.attempts < 3) {
    await query("update studio_versions set status = 'queued', run_after = now() + ($2 || ' seconds')::interval, error = $3 where id = $1", [v.id, String(25 * v.attempts), msg.slice(0, 400)]);
    return;
  }
  const user = e instanceof EngineError ? e.userMessage : 'We could not make this design. You were not charged for it.';
  await query("update studio_versions set status = 'failed', error = $2, user_error = $3 where id = $1", [v.id, msg.slice(0, 400), user]);
  if (v.free) await unlogSketch(v.id);
  await afterFailure(v, p);
}

/** When everything a customer paid for has failed, the money goes back by itself. */
async function afterFailure(v: Version, p: Project) {
  if (v.free || v.kind === 'sketch') return;
  const live = await one<{ n: string }>(`select count(*) as n from studio_versions where project_id = $1 and status in ('queued','running','ready')`, [p.id]);
  if (Number(live?.n ?? 0) === 0) {
    const { refundProject } = await import('./purchases');
    await refundProject(p.id, 'Every design failed to build, so your payment was returned.').catch((e) => console.error(`[brandit] studio auto-refund failed: ${e?.message ?? e}`));
  }
}

async function afterReady(v: Version, p: Project) {
  if (v.kind === 'sketch' || v.kind === 'tweak') return;
  const left = await one<{ n: string }>(`select count(*) as n from studio_versions where project_id = $1 and status in ('queued','running') and kind not in ('sketch','tweak')`, [p.id]);
  if (Number(left?.n ?? 0) > 0) return;
  const key = `${v.kind}:${v.round}`;
  const done = await one('select 1 as x from studio_audit where project_id = $1 and action = $2 and detail->>$3 = $4', [p.id, 'notified_ready', 'batch', key]);
  if (done) return;
  await audit(p.id, 'system', 'notified_ready', { batch: key });
  const { notifyDesignsReady } = await import('./notify');
  await notifyDesignsReady(p.id).catch(() => {});
}

/** Compose a version without waiting for the queue. Used for words-only changes, which cost nothing. */
export async function processNow(versionId: string) {
  const v = await one<Version>("update studio_versions set status = 'running', locked_at = now(), attempts = attempts + 1 where id = $1 and status = 'queued' returning *", [versionId]);
  if (v) await generateJob(v);
}

// ---------- The print file ----------
async function finishJob(v: Version) {
  const s = await getSettings();
  const p = await getProject(v.project_id);
  if (!p || p.status === 'purged' || !v.art_key) { await query("update studio_versions set finish_status = 'failed', finish_error = 'missing' where id = $1", [v.id]); return; }
  const spec = v.spec as Spec;
  try {
    const art = await getFile(v.art_key);
    const scene = await buildScene(v, art, s);
    const up = await upscaleTo(art, spec.w, spec.h, { projectId: v.project_id, versionId: v.id }, s);
    const round = spec.shape === 'round';
    const format = round || spec.mp <= 16 ? 'png' : 'jpeg';
    const file = await renderRaster({ layout: scene.layout, outW: spec.w, outH: spec.h, palette: scene.palette, art: up.buf, photo: scene.photo, photoCut: scene.photoCut, logo: scene.logo, round, format, dpi: spec.passDpi, quality: 92 });
    // A PDF with the words as vector shapes, for the printer. Capped so a banner does not make a huge file twice.
    const cap = Math.min(1, 8000 / Math.max(spec.w, spec.h));
    const pdf = await renderPdf({ layout: scene.layout, outW: Math.round(spec.w * cap), outH: Math.round(spec.h * cap), palette: scene.palette, art: up.buf, photo: scene.photo, photoCut: scene.photoCut, logo: scene.logo, round, printWIn: spec.printWIn, printHIn: spec.printHIn });
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const prod = await getProduct(spec.slug);
    const check = checkStudio({
      spec, layout: scene.layout, tier: p.tier ?? 'standard', art: v.art_w && v.art_h ? { w: v.art_w, h: v.art_h } : null,
      photo: scene.photoAsset?.width_px && scene.photoAsset?.height_px ? { w: scene.photoAsset.width_px, h: scene.photoAsset.height_px } : null,
      logo: scene.logoAsset?.width_px && scene.logoAsset?.height_px ? { w: scene.logoAsset.width_px, h: scene.logoAsset.height_px } : null,
      file: { mime, bytes: file.length, w: spec.w, h: spec.h }, thresholds: s.check_thresholds, maxBytes: s.max_upload_mb * 1_000_000, product: prod,
      colours: [scene.palette.bg, scene.palette.accent],
    });
    const finalKey = await putFile(file, format === 'png' ? 'png' : 'jpg');
    const pdfKey = await putFile(pdf, 'pdf');
    if (v.final_key) await deleteFile(v.final_key).catch(() => {});
    if (v.pdf_key) await deleteFile(v.pdf_key).catch(() => {});
    await query(
      `update studio_versions set finish_status = 'done', finish_error = null, final_key = $2, final_mime = $3, final_w = $4, final_h = $5, final_bytes = $6, pdf_key = $7, sha256 = $8, check_result = $9, upscale = $10 where id = $1`,
      [v.id, finalKey, mime, spec.w, spec.h, file.length, pdfKey, sha256(file), JSON.stringify({ ...check, notes: scene.notes }), JSON.stringify({ method: up.method, factor: up.factor, from: up.from, to: up.to, usd: up.usd })],
    );
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error(`[brandit] studio finish ${v.id} failed: ${msg}`);
    if (v.finish_attempts < 3) await query("update studio_versions set finish_status = 'queued', finish_run_after = now() + ($2 || ' seconds')::interval, finish_error = $3 where id = $1", [v.id, String(30 * v.finish_attempts), msg.slice(0, 400)]);
    else {
      await query("update studio_versions set finish_status = 'failed', finish_error = $2 where id = $1", [v.id, msg.slice(0, 400)]);
      // The attempt did not make a print file, so it does not count against the allowance.
      await query('update studio_projects set finishes = greatest(0, finishes - 1) where id = $1', [v.project_id]);
    }
  }
}

// ---------- The vector file ----------
export async function requestVector(projectId: string, versionId: string): Promise<boolean> {
  const r = await one<{ id: string }>(
    `update studio_versions set payload = jsonb_set(payload, '{vector}', '"queued"') where id = $1 and project_id = $2 and status = 'ready' and svg_key is null returning id`,
    [versionId, projectId],
  );
  if (r) kick();
  return !!r;
}

async function vectorJob(v: Version) {
  const s = await getSettings();
  const p = await getProject(v.project_id);
  const fail = async (msg: string) => {
    await query(`update studio_versions set payload = jsonb_set(payload, '{vector}', '"failed"') where id = $1`, [v.id]);
    console.error(`[brandit] studio vector ${v.id} failed: ${msg}`);
    if (p && !p.from_pack && p.tier === 'standard') {
      const { refundSku } = await import('./purchases');
      await refundSku(p.id, 'vector', 'The vector file could not be made, so its price was returned.').catch(() => {});
    }
  };
  if (!p || !v.art_key) return fail('missing');
  try {
    const spec = v.spec as Spec;
    const art = await getFile(v.art_key);
    const scene = await buildScene(v, art, s, { cut: false });
    const vec = await vectoriseArt(art, { projectId: v.project_id, versionId: v.id }, [scene.palette.bg, scene.palette.accent, scene.palette.soft], { w: scene.ref.w, h: scene.ref.h }, s);
    const clean = sanitiseSvg(vec.svg);
    if (!clean) return fail('vendor SVG failed the safety check');
    const svg = await renderSvg({ layout: scene.layout, outW: 0, outH: 0, palette: scene.palette, art: null, artSvg: clean, photo: scene.photo, photoCut: scene.photoCut, logo: scene.logo, printWIn: spec.printWIn, printHIn: spec.printHIn });
    const key = await putFile(Buffer.from(svg, 'utf8'), 'svg');
    await query(`update studio_versions set svg_key = $2, payload = jsonb_set(payload, '{vector}', '"done"') where id = $1`, [v.id, key]);
  } catch (e) {
    await fail((e as Error)?.message ?? String(e));
  }
}
