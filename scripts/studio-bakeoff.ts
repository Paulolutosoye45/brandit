/*
 * Brandit Studio bake-off: 40 realistic Nigerian briefs run through every picture maker you have a key for.
 * It answers one question before customers do: which engine gives the best print background for the least money.
 *
 *   Plan only (spends nothing):     npx tsx scripts/studio-bakeoff.ts
 *   Run it (spends real money):     npx tsx scripts/studio-bakeoff.ts --go
 *   Check the script itself (free):  npx tsx scripts/studio-bakeoff.ts --selftest --limit 6
 *   Smaller trial:                  npx tsx scripts/studio-bakeoff.ts --go --limit 8 --engines recraft,flux
 *   Also try the enlargers:         npx tsx scripts/studio-bakeoff.ts --go --limit 5 --upscale
 *   Score, then summarise:          open bakeoff-out/<run>/contact-sheet.html, fill scores.csv, then
 *                                   npx tsx scripts/studio-bakeoff.ts --summarise bakeoff-out/<run>
 *
 * Keys are read from the environment or from a .env file in the project folder (RECRAFT_API_KEY, BFL_API_KEY,
 * GEMINI_API_KEY, OPENAI_API_KEY, FAL_KEY). Only engines with a key are run. No database is touched.
 * Model names can be changed for the run: --model recraft=recraftv4,flux=flux-pro-1.1
 * Prices come from lib/studio/providers/catalog.ts; check them against each vendor's rate card first.
 *
 * What it measures for you: cost, time, native pixels, the dpi the picture would have at print size, how much it has to
 * be enlarged, how busy the middle is (words go there), how sharp it is, and how close the colours are to the palette.
 * What only a person can judge: stray letters, faces, taste, cultural fit. The contact sheet and scores.csv are for that.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { OCCASIONS, PALETTES, STYLES, occasionById, paletteById } from '../content/studio';
import { buildArt, defaultBrief } from '../lib/studio/prompts';
import { ENGINES, ENGINE_IDS, OP_USD, keyFor, resolveEngine, type Resolved } from '../lib/studio/providers/catalog';
import { EngineError, type EngineId, type GenIn, type Raw } from '../lib/studio/providers/types';
import { fakeGenerate } from '../lib/studio/providers/fake';
import { fluxGenerate, geminiGenerate, localUpscale, openaiGenerate, recraftGenerate, topazUpscale } from '../lib/studio/providers/vendors';

// ---------------------------------------------------------------- the briefs
type ProductKey = 'flyer' | 'poster' | 'tee' | 'frame' | 'banner' | 'rollup' | 'card' | 'sticker';
const PRODUCTS: Record<ProductKey, { slug: string; name: string; w: number; h: number; dpi: number }> = {
  flyer: { slug: 'flyers', name: 'Flyer', w: 5.83, h: 8.27, dpi: 300 },
  poster: { slug: 'posters', name: 'Poster', w: 11.69, h: 16.54, dpi: 300 },
  tee: { slug: 'branded-t-shirts', name: 'T-shirt', w: 11, h: 14, dpi: 200 },
  frame: { slug: 'picture-frames', name: 'Picture frame', w: 8, h: 10, dpi: 200 },
  banner: { slug: 'flex-banners', name: 'Flex banner', w: 72, h: 36, dpi: 100 },
  rollup: { slug: 'roll-up-banners', name: 'Roll-up banner', w: 33.5, h: 78.7, dpi: 100 },
  card: { slug: 'business-cards', name: 'Business card', w: 3.5, h: 2, dpi: 300 },
  sticker: { slug: 'stickers', name: 'Sticker', w: 3, h: 3, dpi: 300 },
};
type BriefDef = { occ: string; style: string; palette: string; look: string; prod: ProductKey; photo?: boolean };

/** Real-sounding requests, in the English, Pidgin and mixed wording customers actually type. Dignified occasions are included on purpose. */
const BRIEFS: BriefDef[] = [
  // Owambe and parties
  { occ: 'owambe', style: 'ankara', palette: 'royal-gold', look: 'aso-ebi royal blue and gold, make e fine fine', prod: 'flyer' },
  { occ: 'owambe', style: 'aso-oke', palette: 'wine-cream', look: 'agbada and gele colours, rich and royal', prod: 'poster' },
  { occ: 'owambe', style: 'gold-white', palette: 'emerald-gold', look: 'elegant, plenty gold, no cartoon', prod: 'banner' },
  { occ: 'owambe', style: 'ankara', palette: 'coral-teal', look: 'bright and joyful, sharp sharp', prod: 'tee' },
  { occ: 'owambe', style: 'bold-pop', palette: 'purple-gold', look: 'colourful, na the main vibe', prod: 'rollup' },
  // Weddings
  { occ: 'wedding', style: 'floral', palette: 'wine-cream', look: 'soft roses and leaves, romantic', prod: 'flyer', photo: true },
  { occ: 'wedding', style: 'gold-white', palette: 'navy-gold', look: 'white wedding, clean and classy', prod: 'poster', photo: true },
  { occ: 'wedding', style: 'aso-oke', palette: 'royal-gold', look: 'traditional wedding, aso-oke weave and gold thread', prod: 'frame', photo: true },
  { occ: 'wedding', style: 'modern-minimal', palette: 'lemon-white', look: 'simple and light, lots of space', prod: 'sticker' },
  // Church and mosque
  { occ: 'church', style: 'church-serene', palette: 'navy-silver', look: 'calm light from above, peaceful', prod: 'flyer' },
  { occ: 'church', style: 'gold-white', palette: 'navy-gold', look: 'thanksgiving service, dignified, no balloons', prod: 'poster' },
  { occ: 'church', style: 'modern-minimal', palette: 'emerald-gold', look: 'ramadan evening, crescent moon shapes, quiet', prod: 'rollup' },
  { occ: 'church', style: 'church-serene', palette: 'purple-gold', look: 'harvest, soft golden light', prod: 'banner' },
  // Naming ceremonies
  { occ: 'naming', style: 'floral', palette: 'peach-navy', look: 'welcome baby, gentle and warm', prod: 'flyer' },
  { occ: 'naming', style: 'ankara', palette: 'emerald-gold', look: 'family cloth colours, joyful', prod: 'frame', photo: true },
  // Memorials: must be calm, never playful
  { occ: 'memorial', style: 'church-serene', palette: 'navy-silver', look: 'a quiet tribute, soft and respectful', prod: 'poster', photo: true },
  { occ: 'memorial', style: 'gold-white', palette: 'black-gold', look: 'celebration of life, dignified', prod: 'frame', photo: true },
  { occ: 'memorial', style: 'modern-minimal', palette: 'wine-cream', look: 'simple and respectful, deep wine', prod: 'flyer', photo: true },
  // Birthdays
  { occ: 'birthday', style: 'bold-pop', palette: 'coral-teal', look: '30th birthday, fun and colourful', prod: 'tee' },
  { occ: 'birthday', style: 'dark-luxe', palette: 'black-gold', look: 'black and gold, 40 and fabulous', prod: 'poster' },
  { occ: 'birthday', style: 'floral', palette: 'peach-navy', look: 'garden party, fresh flowers', prod: 'flyer' },
  { occ: 'birthday', style: 'bold-pop', palette: 'lemon-black', look: 'kids party, bright shapes, no characters', prod: 'sticker' },
  // School and groups
  { occ: 'school', style: 'modern-minimal', palette: 'royal-gold', look: 'class of 2026, proud and smart', prod: 'tee' },
  { occ: 'school', style: 'bold-pop', palette: 'lemon-black', look: 'sports day, energy', prod: 'banner' },
  { occ: 'group', style: 'ankara', palette: 'purple-gold', look: 'family reunion, everyone in one colour', prod: 'tee' },
  { occ: 'group', style: 'lagos-skyline', palette: 'lemon-black', look: 'Lagos pride, danfo yellow', prod: 'tee' },
  // Shops and promos
  { occ: 'shop', style: 'bold-pop', palette: 'lemon-black', look: 'grand opening, big and loud', prod: 'banner' },
  { occ: 'shop', style: 'earthy', palette: 'wine-cream', look: 'handmade fabrics and beads, warm', prod: 'flyer' },
  { occ: 'shop', style: 'modern-minimal', palette: 'emerald-gold', look: 'fresh food, clean and trusted', prod: 'poster' },
  { occ: 'shop', style: 'lagos-skyline', palette: 'coral-teal', look: 'Lagos street market, lively', prod: 'rollup' },
  // Event nights
  { occ: 'party', style: 'neon-night', palette: 'purple-gold', look: 'detty december, beach night, glow', prod: 'poster' },
  { occ: 'party', style: 'neon-night', palette: 'black-gold', look: 'club night, music and lights', prod: 'flyer' },
  { occ: 'party', style: 'bold-pop', palette: 'coral-teal', look: 'sunday brunch, fresh and sunny', prod: 'rollup' },
  { occ: 'party', style: 'lagos-skyline', palette: 'navy-gold', look: 'Lagos sunset concert', prod: 'banner' },
  // Business
  { occ: 'business', style: 'modern-minimal', palette: 'navy-silver', look: 'accountant, clean and trusted', prod: 'card' },
  { occ: 'business', style: 'dark-luxe', palette: 'black-gold', look: 'premium salon, fine lines', prod: 'card' },
  { occ: 'business', style: 'modern-minimal', palette: 'lemon-white', look: 'bakery, friendly and light', prod: 'sticker' },
  // Something else
  { occ: 'other', style: 'adire', palette: 'royal-gold', look: 'adire indigo, hand-drawn white motifs', prod: 'poster' },
  { occ: 'other', style: 'earthy', palette: 'peach-navy', look: 'mud-cloth patterns, terracotta', prod: 'flyer' },
  { occ: 'other', style: 'gold-white', palette: 'wine-cream', look: 'anniversary, 25 years, elegant', prod: 'frame', photo: true },
];

// A typo in a brief above fails loudly, before anything is spent.
for (const b of BRIEFS) {
  if (!OCCASIONS.some((o) => o.id === b.occ)) throw new Error(`Unknown occasion ${b.occ}`);
  if (!STYLES.some((s) => s.id === b.style)) throw new Error(`Unknown style ${b.style}`);
  if (!PALETTES.some((p) => p.id === b.palette)) throw new Error(`Unknown palette ${b.palette}`);
}

// ---------------------------------------------------------------- command line
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

function loadDotEnv() {
  const f = path.resolve(process.cwd(), '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const usd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;
const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// ---------------------------------------------------------------- measuring a picture
type Metrics = { nativeW: number; nativeH: number; bytes: number; nativeDpi: number; enlarge: number; aspectErr: number; centreBusy: number; sharp: number; colourGap: number };

const hexRgb = (h: string): [number, number, number] => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

async function measure(img: Buffer, want: { aspect: number; printW: number; printH: number; dpi: number }, palette: string[]): Promise<Metrics> {
  const meta = await sharp(img, { limitInputPixels: 300_000_000 }).metadata();
  const w = meta.width ?? 1, h = meta.height ?? 1;
  // Busyness of the middle: spread of brightness in the central half. Calm backgrounds score low; words read best on those.
  const side = 64;
  const small = await sharp(img, { limitInputPixels: 300_000_000 }).resize(side, side, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = small.info.channels;
  const lum = (i: number) => 0.2126 * small.data[i * ch] + 0.7152 * small.data[i * ch + 1] + 0.0722 * small.data[i * ch + 2];
  let n = 0, sum = 0, sum2 = 0;
  for (let y = side / 4; y < (side * 3) / 4; y++) for (let x = side / 4; x < (side * 3) / 4; x++) { const l = lum(y * side + x); n++; sum += l; sum2 += l * l; }
  const centreBusy = Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2));
  // Colour fidelity: average distance from each cell to the nearest palette colour, 0 (exact) to 1 (opposite).
  const pal = palette.map(hexRgb);
  let gap = 0;
  for (let i = 0; i < side * side; i++) {
    const r = small.data[i * ch], g = small.data[i * ch + 1], b = small.data[i * ch + 2];
    gap += Math.min(...pal.map((p) => Math.hypot(r - p[0], g - p[1], b - p[2]))) / 441.67;
  }
  // Sharpness: spread of a Laplacian over a 1024-wide copy, so engines of different sizes are comparable.
  const lap = await sharp(img, { limitInputPixels: 300_000_000 }).resize({ width: 1024, withoutEnlargement: true }).greyscale()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 }).raw().toBuffer();
  let m = 0, m2 = 0;
  for (let i = 0; i < lap.length; i++) { m += lap[i]; m2 += lap[i] * lap[i]; }
  const sharpness = Math.sqrt(Math.max(0, m2 / lap.length - (m / lap.length) ** 2));
  const needW = Math.round(want.printW * want.dpi), needH = Math.round(want.printH * want.dpi);
  return {
    nativeW: w, nativeH: h, bytes: img.length,
    nativeDpi: +Math.min(w / want.printW, h / want.printH).toFixed(0),
    enlarge: +Math.max(needW / w, needH / h).toFixed(2),
    aspectErr: +Math.abs(Math.log(w / h / want.aspect)).toFixed(3),
    centreBusy: +centreBusy.toFixed(1), sharp: +sharpness.toFixed(1), colourGap: +(gap / (side * side)).toFixed(3),
  };
}

// ---------------------------------------------------------------- running
type Row = {
  id: string; engine: EngineId; model: string; ok: boolean; error?: string; ms: number; usd: number; file?: string; thumb?: string;
  metrics?: Metrics;
};
type Plan = { id: string; def: BriefDef; input: GenIn; occLabel: string; styleLabel: string; paletteLabel: string; want: { aspect: number; printW: number; printH: number; dpi: number }; palette: string[] };

function planBriefs(limit: number): Plan[] {
  return BRIEFS.slice(0, limit).map((def, i) => {
    const p = PRODUCTS[def.prod];
    const occ = occasionById(def.occ);
    const pal = paletteById(def.palette);
    const brief = { ...defaultBrief(occ.id), look: def.look, style: def.style, palette: def.palette };
    const input = buildArt({
      brief, spec: { printWIn: p.w, printHIn: p.h, productName: p.name, slug: p.slug }, variation: i, palette: pal, hasPhoto: !!def.photo, hasLogo: false, seed: 1000 + i,
    });
    return {
      id: `b${String(i + 1).padStart(2, '0')}`, def, input, occLabel: occ.label, styleLabel: STYLES.find((s) => s.id === def.style)?.label ?? def.style, paletteLabel: pal.label,
      want: { aspect: p.w / p.h, printW: p.w, printH: p.h, dpi: p.dpi }, palette: [pal.bg, pal.accent, pal.soft],
    };
  });
}

const SELFTEST = flag('selftest');
async function callEngine(e: Resolved, i: GenIn): Promise<Raw> {
  if (SELFTEST) return fakeGenerate(i);
  switch (e.vendor) {
    case 'recraft': return recraftGenerate(e, i, 'digital_illustration');
    case 'bfl': return fluxGenerate(e, i);
    case 'google': return geminiGenerate(e, i);
    case 'openai': return openaiGenerate(e, i);
    default: throw new EngineError(`No adapter for ${e.vendor}`, false);
  }
}

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } }));
}

function parseModels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (opt('model') ?? '').split(',').filter(Boolean)) { const [k, v] = pair.split('='); if (k && v) out[k.trim()] = v.trim(); }
  return out;
}

async function run() {
  const limit = Math.min(BRIEFS.length, Math.max(1, Number(opt('limit') ?? BRIEFS.length)));
  const models = parseModels();
  const wanted = (opt('engines') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const w of wanted) if (!(w in ENGINES)) { console.error(`Unknown engine "${w}". Choose from: ${ENGINE_IDS.join(', ')}`); process.exit(2); }
  const engines = (wanted.length ? (wanted as EngineId[]) : ENGINE_IDS).map((id) => resolveEngine(id, { studio_models: models, studio_price_overrides: {} }));
  // --selftest uses the built-in drawing engine (free) to prove the script, the contact sheet and the summary work.
  const live = SELFTEST ? engines.slice(0, 2) : engines.filter((e) => !!keyFor(e.vendor));
  const missing = SELFTEST ? [] : engines.filter((e) => !keyFor(e.vendor));
  const plans = planBriefs(limit);
  const calls = plans.length * live.length;
  const est = plans.length * live.reduce((a, e) => a + e.usd, 0);
  const cap = Number(opt('max-usd') ?? 25);

  console.log(`Brandit Studio bake-off: ${plans.length} briefs`);
  console.log(`Engines with a key: ${live.map((e) => `${e.label} (${e.model}, ${usd(e.usd)})`).join('; ') || 'none'}`);
  if (missing.length) console.log(`Skipped (no key): ${missing.map((e) => e.label).join(', ')}`);
  console.log(`Calls: ${calls}. Estimated spend: ${usd(est)} (limit ${usd(cap)}, change with --max-usd).`);
  if (!live.length) { console.log('\nNo vendor keys found. Put them in .env or the environment and run again.'); return; }
  if (!flag('go') && !SELFTEST) { console.log('\nThis was a plan only. Nothing was spent. Add --go to run it for real.'); return; }
  if (est > cap) { console.error(`\nStopped: the estimate ${usd(est)} is above the limit ${usd(cap)}. Raise --max-usd or use --limit / --engines.`); process.exit(2); }

  const dir = opt('out') ?? path.join('bakeoff-out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  mkdirSync(path.join(dir, 'img'), { recursive: true });
  mkdirSync(path.join(dir, 'thumb'), { recursive: true });

  const jobs = plans.flatMap((p) => live.map((e) => ({ p, e })));
  const rows: Row[] = [];
  let spent = 0, done = 0;
  const perVendor = new Map<string, number>();
  await pool(jobs, Number(opt('concurrency') ?? 3), async ({ p, e }) => {
    // Be kind to rate limits: at most two calls to one vendor at the same moment.
    while ((perVendor.get(e.vendor) ?? 0) >= 2) await new Promise((r) => setTimeout(r, 400));
    perVendor.set(e.vendor, (perVendor.get(e.vendor) ?? 0) + 1);
    const t0 = Date.now();
    const row: Row = { id: p.id, engine: e.id, model: e.model, ok: false, ms: 0, usd: 0 };
    try {
      if (spent + e.usd > cap) throw new Error('spend limit reached');
      const raw = await callEngine(e, p.input);
      row.ms = Date.now() - t0;
      row.usd = e.usd;
      spent += e.usd;
      const base = `${p.id}-${e.id}`;
      const full = path.join(dir, 'img', `${base}.png`);
      writeFileSync(full, await sharp(raw.image, { limitInputPixels: 300_000_000 }).png().toBuffer());
      await sharp(raw.image, { limitInputPixels: 300_000_000 }).resize({ width: 520, withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(path.join(dir, 'thumb', `${base}.jpg`));
      row.file = `img/${base}.png`;
      row.thumb = `thumb/${base}.jpg`;
      row.metrics = await measure(raw.image, p.want, p.palette);
      row.ok = true;
    } catch (err) {
      row.ms = Date.now() - t0;
      row.error = String((err as Error)?.message ?? err).slice(0, 240);
    } finally {
      perVendor.set(e.vendor, (perVendor.get(e.vendor) ?? 1) - 1);
    }
    rows.push(row);
    done++;
    const m = row.metrics;
    console.log(`[${done}/${jobs.length}] ${p.id} ${e.id.padEnd(13)} ${row.ok ? `ok ${(row.ms / 1000).toFixed(1)}s ${m!.nativeW}x${m!.nativeH} ${usd(row.usd)}` : `FAILED ${row.error}`}`);
  });
  rows.sort((a, b) => a.id.localeCompare(b.id) || a.engine.localeCompare(b.engine));

  writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ at: new Date().toISOString(), briefs: plans.map((p) => ({ id: p.id, ...p.def, occLabel: p.occLabel, styleLabel: p.styleLabel, paletteLabel: p.paletteLabel, prompt: p.input.prompt, want: p.want })), engines: live.map((e) => ({ id: e.id, label: e.label, model: e.model, usd: e.usd })), rows }, null, 2));
  writeFileSync(path.join(dir, 'results.csv'), [
    'brief,engine,model,ok,seconds,usd,native_w,native_h,native_dpi,enlarge_x,aspect_err,centre_busy,sharpness,colour_gap,error',
    ...rows.map((r) => [r.id, r.engine, r.model, r.ok, (r.ms / 1000).toFixed(1), r.usd, r.metrics?.nativeW, r.metrics?.nativeH, r.metrics?.nativeDpi, r.metrics?.enlarge, r.metrics?.aspectErr, r.metrics?.centreBusy, r.metrics?.sharp, r.metrics?.colourGap, r.error].map(csvCell).join(',')),
  ].join('\n'));
  writeFileSync(path.join(dir, 'scores.csv'), [
    'brief,engine,no_stray_text_0or1,calm_centre_0to2,colours_match_0to2,nigerian_fit_0to2,dignified_ok_0or1_blank_if_not_memorial_or_church,clean_no_artefacts_0to2,overall_0to5,notes',
    ...rows.filter((r) => r.ok).map((r) => `${r.id},${r.engine},,,,,,,,`),
  ].join('\n'));
  writeFileSync(path.join(dir, 'contact-sheet.html'), contactSheet(plans, live, rows));

  if (flag('upscale')) await tryEnlargers(dir, plans, rows);

  console.log(`\nDone. ${rows.filter((r) => r.ok).length} of ${rows.length} calls worked. Spent about ${usd(spent)}.`);
  console.log(`Open ${path.join(dir, 'contact-sheet.html')} to look at the pictures, fill ${path.join(dir, 'scores.csv')}, then run:`);
  console.log(`  npx tsx scripts/studio-bakeoff.ts --summarise ${dir}`);
}

// ---------------------------------------------------------------- the contact sheet
function contactSheet(plans: Plan[], engines: Resolved[], rows: Row[]): string {
  const cell = (p: Plan, e: Resolved) => {
    const r = rows.find((x) => x.id === p.id && x.engine === e.id);
    if (!r) return '<td class="miss">not run</td>';
    if (!r.ok) return `<td class="fail"><b>Failed</b><br><small>${esc(r.error ?? '')}</small></td>`;
    const m = r.metrics!;
    return `<td><a href="${r.file}" target="_blank"><img loading="lazy" src="${r.thumb}" alt="${esc(`${p.id} ${e.label}`)}"></a>
      <div class="m"><b>${(r.ms / 1000).toFixed(1)}s</b> · ${usd(r.usd)} · ${m.nativeW}×${m.nativeH}</div>
      <div class="m">${m.nativeDpi} dpi at print size · enlarge ×${m.enlarge}</div>
      <div class="m">middle busyness ${m.centreBusy} · sharp ${m.sharp} · colour gap ${m.colourGap}</div></td>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Studio bake-off</title>
<style>body{font:15px/1.45 system-ui,sans-serif;margin:0;padding:20px;background:#fafaf7;color:#14263f}h1{margin:0 0 6px}table{border-collapse:collapse;width:100%;margin-top:18px}
th,td{border:1px solid #d9d9d2;padding:10px;vertical-align:top;background:#fff}th{background:#14263f;color:#fff;text-align:left;position:sticky;top:0;z-index:2}
td img{width:100%;max-width:360px;display:block;border-radius:6px}.m{font-size:12px;color:#555;margin-top:3px}.fail{background:#fff0ee}.miss{color:#999}
.b{min-width:210px;max-width:260px}.b small{display:block;color:#666;margin-top:4px}.tag{display:inline-block;background:#eef2f7;border-radius:10px;padding:1px 8px;font-size:12px;margin:2px 3px 0 0}
.note{background:#fff6da;border:1px solid #e8b931;border-radius:8px;padding:10px 14px;max-width:900px}</style></head><body>
<h1>Brandit Studio bake-off</h1>
<p class="note"><b>How to judge.</b> For each row, look at the pictures for: stray letters or numbers (an instant fail: Brandit sets all words itself), faces, a calm middle where words will sit,
palette match, Nigerian feel, and for memorials and church programmes a dignified mood. Click a picture for the full-size file. Record your scores in <code>scores.csv</code>
(use a spreadsheet), then run the summary command to get cost per usable design for each engine.</p>
<table><thead><tr><th>Brief</th>${engines.map((e) => `<th>${esc(e.label)}<br><small>${esc(e.model)} · ${usd(e.usd)}</small></th>`).join('')}</tr></thead><tbody>
${plans.map((p) => `<tr><td class="b"><b>${p.id}</b> ${esc(p.occLabel)}<br><span class="tag">${esc(p.styleLabel)}</span><span class="tag">${esc(p.paletteLabel)}</span><span class="tag">${esc(PRODUCTS[p.def.prod].name)} ${PRODUCTS[p.def.prod].w}×${PRODUCTS[p.def.prod].h} in</span>
<small>“${esc(p.def.look)}”</small>${p.def.photo ? '<small>A photo will be placed in the middle.</small>' : ''}</td>${engines.map((e) => cell(p, e)).join('')}</tr>`).join('\n')}
</tbody></table></body></html>`;
}

// ---------------------------------------------------------------- the enlargers
async function tryEnlargers(dir: string, plans: Plan[], rows: Row[]) {
  mkdirSync(path.join(dir, 'upscale'), { recursive: true });
  const seen = new Set<string>();
  const picks = rows.filter((r) => r.ok && r.file && !seen.has(r.engine) && seen.add(r.engine));
  const lines: string[] = ['brief,engine,method,from,to,seconds,usd,note'];
  for (const r of picks) {
    const p = plans.find((x) => x.id === r.id)!;
    const w = Math.round(p.want.printW * p.want.dpi), h = Math.round(p.want.printH * p.want.dpi);
    const src = readFileSync(path.join(dir, r.file!));
    const meta = await sharp(src).metadata();
    const factor = Math.max(w / meta.width!, h / meta.height!);
    const crop = async (buf: Buffer, name: string) => {
      const m = await sharp(buf).metadata();
      const cw = Math.min(900, m.width!), ch = Math.min(900, m.height!);
      await sharp(buf).extract({ left: Math.floor((m.width! - cw) / 2), top: Math.floor((m.height! - ch) / 2), width: cw, height: ch }).png().toFile(path.join(dir, 'upscale', name));
    };
    if (factor <= 1.02) { lines.push(`${r.id},${r.engine},none,${meta.width}x${meta.height},${w}x${h},0,0,already big enough`); continue; }
    let t0 = Date.now();
    const local = await localUpscale(src, Math.round(meta.width! * factor), Math.round(meta.height! * factor));
    await crop(local, `${r.id}-${r.engine}-local.png`);
    lines.push(`${r.id},${r.engine},local,${meta.width}x${meta.height},${w}x${h},${((Date.now() - t0) / 1000).toFixed(1)},0,`);
    if (keyFor('fal')) {
      t0 = Date.now();
      try {
        const up = await topazUpscale(src, Math.ceil(Math.min(4, factor)), process.env.TOPAZ_ENDPOINT ?? 'fal-ai/topaz/upscale/image');
        await crop(up, `${r.id}-${r.engine}-topaz.png`);
        lines.push(`${r.id},${r.engine},topaz,${meta.width}x${meta.height},${w}x${h},${((Date.now() - t0) / 1000).toFixed(1)},${(OP_USD.topazPerMp * (w * h) / 1e6).toFixed(3)},`);
      } catch (e) {
        lines.push(`${r.id},${r.engine},topaz,${meta.width}x${meta.height},${w}x${h},${((Date.now() - t0) / 1000).toFixed(1)},0,${csvCell(String((e as Error).message).slice(0, 120))}`);
      }
    }
  }
  writeFileSync(path.join(dir, 'upscale', 'upscale.csv'), lines.join('\n'));
  console.log(`Enlarger comparison written to ${path.join(dir, 'upscale')}: compare the *-local.png and *-topaz.png crops side by side at 100%.`);
}

// ---------------------------------------------------------------- summary from the scores
function parseCsv(text: string): string[][] {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const out: string[] = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  });
}

function summarise(dir: string) {
  const results = JSON.parse(readFileSync(path.join(dir, 'results.json'), 'utf8')) as { engines: { id: string; label: string; model: string; usd: number }[]; rows: Row[] };
  const scoreFile = path.join(dir, 'scores.csv');
  const scored = new Map<string, Record<string, number | null>>();
  if (existsSync(scoreFile)) {
    const [head, ...body] = parseCsv(readFileSync(scoreFile, 'utf8'));
    const col = (n: string) => head.findIndex((h) => h.startsWith(n));
    const ci = { text: col('no_stray_text'), calm: col('calm_centre'), colour: col('colours_match'), fit: col('nigerian_fit'), dig: col('dignified_ok'), clean: col('clean_no_artefacts'), overall: col('overall') };
    const num = (v: string | undefined) => (v === undefined || v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));
    for (const r of body) scored.set(`${r[0]}|${r[1]}`, { text: num(r[ci.text]), calm: num(r[ci.calm]), colour: num(r[ci.colour]), fit: num(r[ci.fit]), dig: num(r[ci.dig]), clean: num(r[ci.clean]), overall: num(r[ci.overall]) });
  }
  const lines: string[] = ['# Studio bake-off summary', '', `Run folder: \`${dir}\`  ·  ${new Date().toISOString().slice(0, 10)}`, ''];
  lines.push('| Engine | Model | Worked | Avg seconds | Cost per call | Native dpi (median) | Enlarge × (median) | Middle busyness | Scored | Usable* | Cost per usable design | Avg overall |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  const med = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '–');
  const verdicts: { label: string; cpu: number; usable: number; overall: number }[] = [];
  for (const e of results.engines) {
    const rs = results.rows.filter((r) => r.engine === e.id);
    const okRows = rs.filter((r) => r.ok);
    const sc = okRows.map((r) => scored.get(`${r.id}|${r.engine}`)).filter((s): s is Record<string, number | null> => !!s && s.overall !== null);
    // Usable: scored 3 or more overall, no stray text, and (where judged) dignified.
    const usableN = sc.filter((s) => (s.overall ?? 0) >= 3 && s.text !== 0 && s.dig !== 0).length;
    const spent = rs.reduce((a, r) => a + r.usd, 0);
    const cpu = usableN ? spent / usableN : NaN;
    const overall = avg(sc.map((s) => s.overall as number));
    lines.push(`| ${e.label} | ${e.model} | ${okRows.length}/${rs.length} | ${fmt(avg(okRows.map((r) => r.ms / 1000)))} | ${usd(e.usd)} | ${fmt(med(okRows.map((r) => r.metrics!.nativeDpi)), 0)} | ${fmt(med(okRows.map((r) => r.metrics!.enlarge)), 2)} | ${fmt(avg(okRows.map((r) => r.metrics!.centreBusy)))} | ${sc.length} | ${usableN} | ${Number.isFinite(cpu) ? usd(cpu) : '–'} | ${fmt(overall)} |`);
    verdicts.push({ label: e.label, cpu, usable: sc.length ? usableN / sc.length : NaN, overall });
  }
  lines.push('', '*Usable = overall score 3 or more, no stray letters, and dignified where that applies. Cost per usable design = money spent on that engine in this run ÷ its usable pictures. Failed calls are not charged by most vendors, but check your own invoices.', '');
  const ranked = verdicts.filter((v) => Number.isFinite(v.cpu)).sort((a, b) => a.cpu - b.cpu);
  if (ranked.length) {
    lines.push('## What to do with this', '');
    lines.push(`- Cheapest usable design: **${ranked[0].label}** at about ${usd(ranked[0].cpu)} each.`);
    const best = [...verdicts].filter((v) => Number.isFinite(v.overall)).sort((a, b) => b.overall - a.overall)[0];
    if (best) lines.push(`- Highest average quality: **${best.label}** (${best.overall.toFixed(1)} of 5).`);
    lines.push('- Put the cheapest engine whose usable rate is 70% or better first in the Standard chain and the best-quality engine first in the Premium chain (Console, Studio, Settings, Picture makers).', '- Anything with a usable rate under 50% should not be in a chain at all. A free sketch that looks bad costs you the sale.', '- Check the per-call prices above against each vendor\'s current rate card and fix them in Console, Studio, Settings, Picture makers, price overrides, so the margin report is true.');
  } else {
    lines.push('No scores found yet. Fill `scores.csv` (a spreadsheet works) and run this command again.');
  }
  const out = path.join(dir, 'summary.md');
  writeFileSync(out, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\nWritten to ${out}`);
}

// ---------------------------------------------------------------- go
loadDotEnv();
const sum = opt('summarise');
(sum ? Promise.resolve(summarise(sum)) : run()).catch((e) => { console.error(e); process.exit(1); });
