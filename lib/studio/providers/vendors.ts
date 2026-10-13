import sharp from 'sharp';
import type { EngineDef, GenIn, Raw } from './types';
import { EngineError, closestSize, sizeFor } from './types';
import { download, jsonOrThrow, vendorFetch } from './http';
import { keyFor } from './catalog';

/*
 * One function per vendor. Each takes the plain-English art brief and returns a picture.
 * These were written from the vendors' published API documentation. They have not been run against live accounts from
 * the build environment, which is why the console's "Test engines" button and scripts/studio-bakeoff.ts exist: run them
 * once with your keys before opening Studio to customers.
 */
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export async function recraftGenerate(d: EngineDef, i: GenIn, style = 'digital_illustration'): Promise<Raw> {
  const [w, h] = closestSize(d.sizes!, i.aspect);
  const body: Record<string, unknown> = { prompt: cap(i.prompt, 1000), model: d.model, size: `${w}x${h}`, n: 1, response_format: 'url' };
  if (style) body.style = style;
  if (i.negative) body.negative_prompt = cap(i.negative, 500);
  const res = await vendorFetch('https://external.api.recraft.ai/v1/images/generations', {
    method: 'POST', headers: { Authorization: `Bearer ${keyFor('recraft')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, { what: 'Recraft' });
  const j = await jsonOrThrow(res, 'Recraft');
  const item = j?.data?.[0];
  if (item?.b64_json) return { image: Buffer.from(item.b64_json, 'base64'), mime: 'image/png' };
  if (!item?.url) throw new EngineError('Recraft returned no picture', true);
  const dl = await download(item.url);
  return { image: dl.buf, mime: dl.mime };
}

async function recraftFileOp(path: string, buf: Buffer, what: string, extra: Record<string, string> = {}): Promise<Awaited<ReturnType<typeof download>>> {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(buf)], { type: 'image/png' }), 'input.png');
  fd.append('response_format', 'url');
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const res = await vendorFetch(`https://external.api.recraft.ai/v1/images/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${keyFor('recraft')}` }, body: fd }, { what: `Recraft ${what}`, timeoutMs: 120_000 });
  const j = await jsonOrThrow(res, `Recraft ${what}`);
  const url = j?.image?.url ?? j?.data?.[0]?.url;
  if (!url) throw new EngineError(`Recraft ${what} returned nothing`, true);
  return download(url);
}
export const recraftVectorise = async (buf: Buffer) => (await recraftFileOp('vectorize', buf, 'vectorize')).buf.toString('utf8');
export const recraftCutout = async (buf: Buffer) => (await recraftFileOp('removeBackground', buf, 'background removal')).buf;
export const recraftCrisp = async (buf: Buffer) => (await recraftFileOp('crispUpscale', buf, 'upscale')).buf;

export async function fluxGenerate(d: EngineDef, i: GenIn): Promise<Raw> {
  const [w, h] = sizeFor(i.aspect, d.longSide ?? 1440, 32, 256);
  const prompt = cap(`${i.prompt}. Avoid: ${i.negative}`, 3000);
  const start = await vendorFetch(`https://api.bfl.ai/v1/${d.model}`, {
    method: 'POST', headers: { 'x-key': keyFor('bfl')!, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ prompt, width: Math.min(1440, w), height: Math.min(1440, h), seed: i.seed, output_format: 'png', safety_tolerance: 2, prompt_upsampling: false }),
  }, { what: 'FLUX' });
  const sj = await jsonOrThrow(start, 'FLUX');
  const poll: string | undefined = sj?.polling_url ?? (sj?.id ? `https://api.bfl.ai/v1/get_result?id=${encodeURIComponent(sj.id)}` : undefined);
  if (!poll) throw new EngineError('FLUX gave no result address', true);
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1200));
    const r = await vendorFetch(poll, { headers: { 'x-key': keyFor('bfl')!, accept: 'application/json' } }, { what: 'FLUX', retries: 1, timeoutMs: 30_000 });
    const j = await jsonOrThrow(r, 'FLUX');
    if (j?.status === 'Ready') {
      const url = j?.result?.sample;
      if (!url) throw new EngineError('FLUX finished with no picture', true);
      const dl = await download(url);
      return { image: dl.buf, mime: dl.mime };
    }
    if (j?.status === 'Content Moderated' || j?.status === 'Request Moderated') throw new EngineError('FLUX moderated the request', false, 'That request could not be made. Try describing the look in a different way.');
    if (j?.status === 'Error' || j?.status === 'Failed') throw new EngineError(`FLUX failed: ${JSON.stringify(j).slice(0, 200)}`, true);
  }
  throw new EngineError('FLUX took too long', true);
}

const GEMINI_RATIOS: [string, number][] = [['1:1', 1], ['2:3', 2 / 3], ['3:2', 3 / 2], ['3:4', 3 / 4], ['4:3', 4 / 3], ['4:5', 4 / 5], ['5:4', 5 / 4], ['9:16', 9 / 16], ['16:9', 16 / 9], ['21:9', 21 / 9]];
export async function geminiGenerate(d: EngineDef, i: GenIn): Promise<Raw> {
  const ratio = GEMINI_RATIOS.reduce((b, r) => (Math.abs(Math.log(r[1] / i.aspect)) < Math.abs(Math.log(b[1] / i.aspect)) ? r : b))[0];
  const res = await vendorFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(d.model)}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': keyFor('google')!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: cap(`${i.prompt}\nDo not include: ${i.negative}`, 6000) }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ratio, imageSize: '2K' } },
    }),
  }, { what: 'Google', timeoutMs: 120_000 });
  const j = await jsonOrThrow(res, 'Google');
  const parts: any[] = j?.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p?.inlineData?.data || p?.inline_data?.data);
  const data = img?.inlineData?.data ?? img?.inline_data?.data;
  if (!data) {
    const why = j?.candidates?.[0]?.finishReason ?? j?.promptFeedback?.blockReason;
    throw new EngineError(`Google returned no picture (${why ?? 'no reason'})`, !why, why ? 'That request could not be made. Try describing the look in a different way.' : undefined);
  }
  return { image: Buffer.from(data, 'base64'), mime: img?.inlineData?.mimeType ?? img?.inline_data?.mime_type ?? 'image/png' };
}

export async function openaiGenerate(d: EngineDef, i: GenIn): Promise<Raw> {
  const [w, h] = closestSize(d.sizes!, i.aspect);
  const res = await vendorFetch('https://api.openai.com/v1/images/generations', {
    method: 'POST', headers: { Authorization: `Bearer ${keyFor('openai')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: d.model, prompt: cap(`${i.prompt}\nDo not include: ${i.negative}`, 8000), size: `${w}x${h}`, n: 1, quality: 'high' }),
  }, { what: 'OpenAI', timeoutMs: 150_000 });
  const j = await jsonOrThrow(res, 'OpenAI');
  const item = j?.data?.[0];
  if (item?.b64_json) return { image: Buffer.from(item.b64_json, 'base64'), mime: 'image/png' };
  if (item?.url) { const dl = await download(item.url); return { image: dl.buf, mime: dl.mime }; }
  throw new EngineError('OpenAI returned no picture', true);
}

/** Topaz on fal: enlarges without redrawing faces (face enhancement is switched off on purpose). */
export async function topazUpscale(buf: Buffer, factor: number, endpoint: string, model?: string): Promise<Buffer> {
  const png = await sharp(buf).png().toBuffer();
  const res = await vendorFetch(`https://fal.run/${endpoint.replace(/^\/+/, '')}`, {
    method: 'POST', headers: { Authorization: `Key ${keyFor('fal')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: `data:image/png;base64,${png.toString('base64')}`, upscale_factor: Math.min(4, Math.max(1, factor)), face_enhancement: false, output_format: 'png', ...(model ? { model } : {}) }),
  }, { what: 'Topaz', timeoutMs: 180_000 });
  const j = await jsonOrThrow(res, 'Topaz');
  const url = j?.image?.url ?? j?.images?.[0]?.url;
  if (!url) throw new EngineError('Topaz returned no picture', true);
  return (await download(url)).buf;
}

/** The fallback that needs nobody: a clean Lanczos enlargement with a touch of sharpening. */
export async function localUpscale(buf: Buffer, w: number, h: number): Promise<Buffer> {
  return sharp(buf, { limitInputPixels: 300_000_000 }).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).sharpen({ sigma: 0.6, m1: 0.8, m2: 1.2 }).png().toBuffer();
}
