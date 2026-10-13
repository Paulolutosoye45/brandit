import sharp from 'sharp';
import { isDemo } from '../db';
import { getSettings } from '../settings';
import type { Settings } from '../settings-defaults';
import { ENGINES, isEngineId, keyFor, opUsd, resolveEngine, vendorsOn, type Resolved } from './providers/catalog';
import { EngineError, PausedError, type EngineId, type GenIn } from './providers/types';
import { fakeGenerate, fakeVector } from './providers/fake';
import { fluxGenerate, geminiGenerate, localUpscale, openaiGenerate, recraftCrisp, recraftCutout, recraftGenerate, recraftVectorise, topazUpscale } from './providers/vendors';
import { capState, freeCeiling, recordCall } from './ledger';

/*
 * The one door to the picture makers. It tries the engines of a chain in order, skips any without a key, stops when the
 * month's vendor budget or the day's free-sketch ceiling is reached, writes every call into the ledger, and in demo mode
 * (and only there) falls back to a built-in drawing engine so the whole flow works with no accounts.
 */
export type Ctx = { projectId?: string | null; versionId?: string | null; free?: boolean };
export type GenResult = { image: Buffer; w: number; h: number; engine: string; model: string; usd: number; simulated: boolean; ms: number };

const live = (e: Resolved) => !!keyFor(e.vendor);

export function engineStatus(s: Settings) {
  const on = vendorsOn();
  return (Object.keys(ENGINES) as EngineId[]).map((id) => {
    const e = resolveEngine(id, s);
    return { id, label: e.label, vendor: e.vendor, model: e.model, usd: e.usd, configured: (on as Record<string, boolean>)[e.vendor] === true };
  });
}
export const anyEngineConfigured = () => Object.values(vendorsOn()).some(Boolean);
export const studioRunnable = () => anyEngineConfigured() || isDemo();

async function callEngine(e: Resolved, i: GenIn, s: Settings): Promise<{ image: Buffer; mime: string }> {
  switch (e.vendor) {
    case 'recraft': return recraftGenerate(e, i, (s.studio_models?.['recraft-style'] as string | undefined) ?? 'digital_illustration');
    case 'bfl': return fluxGenerate(e, i);
    case 'google': return geminiGenerate(e, i);
    case 'openai': return openaiGenerate(e, i);
    default: throw new EngineError(`No adapter for ${e.vendor}`, false);
  }
}

async function gate(ctx: Ctx, s: Settings) {
  if (!s.studio_enabled) throw new PausedError('off', 'Studio is switched off.');
  const cap = await capState(s);
  if (cap.state === 'all_off') throw new PausedError('all', `The monthly vendor budget ($${cap.cap}) is spent.`);
  if (ctx.free) {
    if (cap.state !== 'ok') throw new PausedError('sketches', 'Free sketches are paused to protect the vendor budget.');
    const c = await freeCeiling(s);
    if (c.reached) throw new PausedError('ceiling', 'The free-sketch ceiling for today is reached.');
  }
}

export async function generateArt(i: GenIn, chain: string[], ctx: Ctx, settings?: Settings): Promise<GenResult> {
  const s = settings ?? (await getSettings());
  await gate(ctx, s);
  const ids = chain.filter(isEngineId);
  let lastErr: unknown = null;
  for (const id of ids) {
    const e = resolveEngine(id, s);
    if (!live(e)) continue;
    const t0 = Date.now();
    try {
      const raw = await callEngine(e, i, s);
      const meta = await sharp(raw.image, { limitInputPixels: 300_000_000 }).metadata();
      const ms = Date.now() - t0;
      await recordCall({ ...ctx, vendor: e.vendor, model: e.model, op: 'generate', usd: e.usd, free: ctx.free, ms }, s.studio_fx);
      return { image: raw.image, w: meta.width ?? 0, h: meta.height ?? 0, engine: id, model: e.model, usd: e.usd, simulated: false, ms };
    } catch (err) {
      lastErr = err;
      await recordCall({ ...ctx, vendor: e.vendor, model: e.model, op: 'generate', usd: 0, ok: false, free: ctx.free, ms: Date.now() - t0 }, s.studio_fx).catch(() => {});
      // A refusal on content grounds is final. Another vendor must not be used to get around it.
      if (err instanceof EngineError && !err.retryable && /moderat|safety|policy|could not be made/i.test(err.message + err.userMessage)) throw err;
      console.error(`[brandit] studio engine ${id} failed: ${(err as Error)?.message ?? err}`);
    }
  }
  if (isDemo()) {
    const t0 = Date.now();
    const first = ids.length ? resolveEngine(ids[0], s) : resolveEngine('recraft', s);
    const raw = await fakeGenerate(i);
    const meta = await sharp(raw.image).metadata();
    const ms = Date.now() - t0;
    await recordCall({ ...ctx, vendor: 'fake', model: first.model, op: 'generate', usd: first.usd, free: ctx.free, simulated: true, ms }, s.studio_fx);
    return { image: raw.image, w: meta.width ?? 0, h: meta.height ?? 0, engine: 'demo', model: 'demo', usd: first.usd, simulated: true, ms };
  }
  if (lastErr instanceof EngineError) throw lastErr;
  throw new EngineError('No picture maker is set up for this step', false, 'Studio is not available right now. Nothing was charged. Please try again later.');
}

export type UpscaleResult = { buf: Buffer; method: 'none' | 'topaz' | 'recraft-crisp' | 'local'; factor: number; usd: number; from: [number, number]; to: [number, number] };

/** Bring a picture to exactly the pixel size the print needs. Never redraws faces: the enlargers used here do not invent faces. */
export async function upscaleTo(buf: Buffer, w: number, h: number, ctx: Ctx, settings?: Settings): Promise<UpscaleResult> {
  const s = settings ?? (await getSettings());
  const meta = await sharp(buf, { limitInputPixels: 300_000_000 }).metadata();
  const sw = meta.width ?? 1, sh = meta.height ?? 1;
  // Picture is covered into the print shape first, so only the needed part is enlarged.
  const cover = Math.max(w / sw, h / sh);
  if (cover <= 1.02) {
    const out = await sharp(buf, { limitInputPixels: 300_000_000 }).resize(w, h, { fit: 'cover', kernel: 'lanczos3' }).png().toBuffer();
    return { buf: out, method: 'none', factor: 1, usd: 0, from: [sw, sh], to: [w, h] };
  }
  const wantMp = (w * h) / 1_000_000;
  const tried: UpscaleResult['method'][] = [];
  const order: ('topaz' | 'recraft-crisp' | 'local')[] = s.studio_upscaler === 'topaz' ? ['topaz', 'recraft-crisp', 'local'] : s.studio_upscaler === 'recraft-crisp' ? ['recraft-crisp', 'topaz', 'local'] : ['local'];
  for (const m of order) {
    const t0 = Date.now();
    try {
      let enlarged: Buffer;
      let usd = 0;
      if (m === 'topaz') {
        if (!keyFor('fal')) continue;
        enlarged = await topazUpscale(buf, Math.ceil(Math.min(4, cover)), (s.studio_models?.topaz as string | undefined) ?? 'fal-ai/topaz/upscale/image', s.studio_models?.['topaz-model'] as string | undefined);
        usd = opUsd('topazPerMp', s) * wantMp;
      } else if (m === 'recraft-crisp') {
        if (!keyFor('recraft')) continue;
        enlarged = await recraftCrisp(buf);
        usd = opUsd('crisp', s);
      } else {
        enlarged = buf;
      }
      const out = await localUpscale(enlarged, Math.max(w, Math.round(sw * cover)), Math.max(h, Math.round(sh * cover)));
      const fitted = await sharp(out, { limitInputPixels: 400_000_000 }).resize(w, h, { fit: 'cover', kernel: 'lanczos3' }).png().toBuffer();
      if (m !== 'local') await recordCall({ ...ctx, vendor: m === 'topaz' ? 'fal' : 'recraft', model: m, op: 'upscale', units: wantMp, usd, ms: Date.now() - t0 }, s.studio_fx);
      return { buf: fitted, method: m, factor: +cover.toFixed(2), usd, from: [sw, sh], to: [w, h] };
    } catch (e) {
      tried.push(m);
      await recordCall({ ...ctx, vendor: m === 'topaz' ? 'fal' : m === 'recraft-crisp' ? 'recraft' : 'local', model: m, op: 'upscale', usd: 0, ok: false, ms: Date.now() - t0 }, s.studio_fx).catch(() => {});
      console.error(`[brandit] studio upscaler ${m} failed: ${(e as Error)?.message ?? e}`);
    }
  }
  throw new EngineError('Upscale failed', true);
}

/** A vector (SVG) version of the art. Demo mode makes a stand-in. */
export async function vectoriseArt(buf: Buffer, ctx: Ctx, palette: string[], size: { w: number; h: number }, settings?: Settings): Promise<{ svg: string; simulated: boolean }> {
  const s = settings ?? (await getSettings());
  await gate({ ...ctx, free: false }, s);
  if (keyFor('recraft')) {
    const t0 = Date.now();
    try {
      const png = await sharp(buf, { limitInputPixels: 300_000_000 }).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      const svg = await recraftVectorise(png);
      await recordCall({ ...ctx, vendor: 'recraft', model: 'vectorize', op: 'vectorise', usd: opUsd('vectorise', s), ms: Date.now() - t0 }, s.studio_fx);
      return { svg, simulated: false };
    } catch (e) {
      await recordCall({ ...ctx, vendor: 'recraft', model: 'vectorize', op: 'vectorise', usd: 0, ok: false, ms: Date.now() - t0 }, s.studio_fx).catch(() => {});
      if (!isDemo()) throw e;
    }
  }
  if (isDemo()) {
    await recordCall({ ...ctx, vendor: 'fake', model: 'vectorize', op: 'vectorise', usd: opUsd('vectorise', s), simulated: true }, s.studio_fx);
    return { svg: fakeVector(size.w, size.h, palette), simulated: true };
  }
  throw new EngineError('No vector maker is set up', false, 'The vector file could not be made right now. Nothing was charged.');
}

/** The person cut out of their photo (background removed). Demo mode makes an oval stand-in so the flow can be tried. */
export async function cutOutPhoto(buf: Buffer, ctx: Ctx, settings?: Settings): Promise<{ png: Buffer; simulated: boolean }> {
  const s = settings ?? (await getSettings());
  if (keyFor('recraft')) {
    const t0 = Date.now();
    try {
      const small = await sharp(buf, { limitInputPixels: 80_000_000 }).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      const png = await recraftCutout(small);
      await recordCall({ ...ctx, vendor: 'recraft', model: 'removeBackground', op: 'cutout', usd: opUsd('cutout', s), ms: Date.now() - t0 }, s.studio_fx);
      return { png, simulated: false };
    } catch (e) {
      await recordCall({ ...ctx, vendor: 'recraft', model: 'removeBackground', op: 'cutout', usd: 0, ok: false }, s.studio_fx).catch(() => {});
      if (!isDemo()) throw e;
    }
  }
  if (isDemo()) {
    const meta = await sharp(buf).rotate().metadata();
    const w = meta.width ?? 800, h = meta.height ?? 1000;
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w * 0.46}" ry="${h * 0.48}" fill="#fff"/></svg>`);
    const png = await sharp(buf).rotate().ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    await recordCall({ ...ctx, vendor: 'fake', model: 'removeBackground', op: 'cutout', usd: opUsd('cutout', s), simulated: true }, s.studio_fx);
    return { png, simulated: true };
  }
  throw new EngineError('No background remover is set up', false, 'The cut-out could not be made right now. Nothing was charged.');
}
