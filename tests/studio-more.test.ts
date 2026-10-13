import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

process.env.PGLITE_DIR = 'memory';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-studio-more-${process.pid}`);
delete process.env.PAYSTACK_SECRET_KEY;
const KEYS = ['RECRAFT_API_KEY', 'BFL_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'FAL_KEY'];
for (const k of KEYS) delete process.env[k];

// Who is signed in, as far as the image route can tell.
const who = vi.hoisted(() => ({ customer: null as any, staff: null as any }));
vi.mock('../lib/session', async (orig) => {
  const real = await orig<typeof import('../lib/session')>();
  return { ...real, getCustomer: async () => who.customer, getStaff: async () => who.staff };
});

let db: typeof import('../lib/db');
let P: typeof import('../lib/studio/projects');
let W: typeof import('../lib/studio/worker');
let B: typeof import('../lib/studio/purchases');
let V: typeof import('../lib/studio/view');
let S: typeof import('../lib/settings');
let I: typeof import('../lib/identity');

beforeAll(async () => {
  db = await import('../lib/db');
  await db.ready();
  P = await import('../lib/studio/projects');
  W = await import('../lib/studio/worker');
  B = await import('../lib/studio/purchases');
  V = await import('../lib/studio/view');
  S = await import('../lib/settings');
  I = await import('../lib/identity');
}, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KEYS) delete process.env[k];
  who.customer = null;
  who.staff = null;
});

let n = 0;
async function newCustomer() {
  n++;
  return (await I.signInPhone(`+23480399${String(10000 + n)}`)).customer;
}
const LINES = { who: 'Chief & Mrs Adéwálé Ọláńrewájú', what: '60th Birthday', date: 'Saturday 14 March 2026, 11am', where: 'Eko Hotel & Suites, Victoria Island', rsvp: 'RSVP: 0803 765 4321' };
const BRIEF = { occasion: 'owambe', lines: LINES, look: 'ankara style, plenty gold, make e fine', style: 'ankara', palette: 'royal-gold', choices: { font: 'montserrat', theme: 'auto', style: 'panels', photoShape: 'rounded' } };

async function project(c: any, brief: any = BRIEF) {
  const pr: any = await P.createProject(c, { productSlug: 'flyers', occasion: 'owambe' });
  expect(pr.ok).toBe(true);
  const id = pr.project.id as string;
  const sb: any = await P.saveBrief(c, id, brief);
  expect(sb.ok, JSON.stringify(sb)).toBe(true);
  await P.setConsent(c, id);
  return id;
}
const photo = () => sharp({ create: { width: 1400, height: 1800, channels: 3, background: '#8a5a3c' } }).jpeg().toBuffer();

describe('the choices shown in the browser match the fonts on the server', () => {
  it('lists exactly the fonts Studio can set, with the same ids and names', async () => {
    const { FONTS } = await import('../lib/studio/fonts');
    const { FONT_CHOICES, SHAPE_CHOICES, THEME_CHOICES } = await import('../content/studio');
    expect(FONT_CHOICES.map((f) => f.id).sort()).toEqual(FONTS.map((f) => f.id).sort());
    for (const f of FONTS) expect(FONT_CHOICES.find((c) => c.id === f.id)?.label).toBe(f.label);
    expect(SHAPE_CHOICES.map((s) => s.id).sort()).toEqual(['circle', 'cutout', 'oval', 'rect', 'rounded']);
    expect(THEME_CHOICES.map((s) => s.id).sort()).toEqual(['auto', 'dark', 'light']);
  });
});

describe('console settings form', () => {
  it('shows the defaults and reads them back unchanged', async () => {
    const { STUDIO_GROUPS, ALL_FIELDS, toInput, parseStudioForm } = await import('../lib/studio/settingsSchema');
    const { DEFAULT_SETTINGS } = await import('../lib/settings-defaults');
    expect(STUDIO_GROUPS.length).toBeGreaterThan(5);
    for (const f of ALL_FIELDS) expect(f.key in DEFAULT_SETTINGS, `${String(f.key)} has a default`).toBe(true);
    const shown = new Map(ALL_FIELDS.map((f) => [f.key as string, toInput(f, DEFAULT_SETTINGS)]));
    const parsed = parseStudioForm((name) => shown.get(name) ?? null);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (parsed.ok) for (const f of ALL_FIELDS) expect(parsed.values[f.key], String(f.key)).toEqual((DEFAULT_SETTINGS as any)[f.key]);
  });

  it('refuses nonsense in plain words instead of saving it', async () => {
    const { ALL_FIELDS, toInput, parseStudioForm } = await import('../lib/studio/settingsSchema');
    const { DEFAULT_SETTINGS } = await import('../lib/settings-defaults');
    const base = new Map(ALL_FIELDS.map((f) => [f.key as string, toInput(f, DEFAULT_SETTINGS)]));
    const bad = (over: Record<string, string>) => parseStudioForm((n) => (n in over ? over[n] : base.get(n) ?? null));
    expect(bad({ studio_standard_kobo: '-5' })).toMatchObject({ ok: false });
    expect(bad({ studio_standard_kobo: 'abc' })).toMatchObject({ ok: false });
    expect(bad({ studio_margin_floor_pct: '250' })).toMatchObject({ ok: false });
    expect(bad({ studio_std_rounds: '1.5' })).toMatchObject({ ok: false });
    expect(bad({ studio_chain_standard: 'recraft, midjourney' })).toMatchObject({ ok: false });
    expect(bad({ studio_chain_standard: '' })).toMatchObject({ ok: false });
    expect(bad({ studio_models: '{not json' })).toMatchObject({ ok: false });
    expect(bad({ studio_price_overrides: '{"recraft": "cheap"}' })).toMatchObject({ ok: false });
    expect(bad({ studio_access: 'nobody' })).toMatchObject({ ok: false });
    const good = bad({ studio_standard_kobo: '3000', studio_chain_premium: 'gpt-image recraft-pro' });
    expect(good).toMatchObject({ ok: true });
    if (good.ok) { expect(good.values.studio_standard_kobo).toBe(300_000); expect(good.values.studio_chain_premium).toEqual(['gpt-image', 'recraft-pro']); }
  });
});

describe('margin at the decided prices', () => {
  it('stays above the floor at full use, and says so when it does not', async () => {
    const { planMargin } = await import('../lib/studio/report');
    const { DEFAULT_SETTINGS } = await import('../lib/settings-defaults');
    for (const tier of ['standard', 'premium'] as const) {
      const p = planMargin(DEFAULT_SETTINGS, tier);
      expect(p.marginPct, `${tier} margin ${p.marginPct}%`).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.studio_margin_floor_pct);
      expect(p.belowFloor).toBe(false);
      expect(p.lines.length).toBeGreaterThan(1);
    }
    // A much weaker naira, or a dearer vendor, must trip the warning.
    const weak = planMargin({ ...DEFAULT_SETTINGS, studio_fx_plan: 6000 }, 'premium');
    expect(weak.belowFloor).toBe(true);
    const dear = planMargin({ ...DEFAULT_SETTINGS, studio_price_overrides: { recraft: 1.5 } }, 'standard');
    expect(dear.belowFloor).toBe(true);
  });
});

describe('what the browser is told', () => {
  it('never contains a storage key, a vendor name or what a picture cost', async () => {
    const c = await newCustomer();
    const id = await project(c);
    await P.addAsset(c, id, 'photo', { name: 'me.jpg', buf: await photo() });
    expect((await P.requestSketch(c, id) as any).ok).toBe(true);
    await W.drainAll();
    const v = await V.projectView(c, id);
    expect(v).not.toBeNull();
    const raw = await db.query<Record<string, string | null>>('select art_key, preview_key, final_key, pdf_key, svg_key from studio_versions where project_id = $1', [id]);
    const assets = await db.query<Record<string, string | null>>('select storage_key, preview_key, cut_key, vector_key from studio_assets where project_id = $1', [id]);
    const text = JSON.stringify(v);
    for (const k of [...raw, ...assets].flatMap((r) => Object.values(r)).filter(Boolean) as string[]) expect(text.includes(k), `storage key ${k} leaked`).toBe(false);
    expect(text).not.toMatch(/recraft|flux|gemini|openai|nano-banana|topaz|bfl|fal\.ai|storage_key|art_key|_usd|usd_/i);
    expect(v!.versions.some((x) => x.preview && x.preview.startsWith('/api/studio/v/'))).toBe(true);
    // Someone else cannot open it at all.
    const other = await newCustomer();
    expect(await V.projectView(other, id)).toBeNull();
  });
});

describe('the payment gate', () => {
  it('takes no money before the words, the consent and the content rules are in order', async () => {
    const c = await newCustomer();
    const pr: any = await P.createProject(c, { productSlug: 'flyers', occasion: 'owambe' });
    const id = pr.project.id as string;
    const empty: any = await B.startPurchase(c, { sku: 'standard', projectId: id });
    expect(empty.ok).toBe(false);
    expect(empty.code).toBe('brief');
    await P.saveBrief(c, id, BRIEF);
    const noConsent: any = await B.startPurchase(c, { sku: 'standard', projectId: id });
    expect(noConsent.ok).toBe(false);
    expect(noConsent.code).toBe('consent');
    await P.setConsent(c, id);
    // Words that break the rules are caught even when they were saved earlier by another route.
    await db.query("update studio_projects set brief = jsonb_set(brief, '{lines,who}', to_jsonb($2::text)) where id = $1", [id, 'Vote APC for governor, join our campaign']);
    const blocked: any = await B.startPurchase(c, { sku: 'standard', projectId: id });
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('blocked');
    const purchases = await db.query('select 1 from studio_purchases where customer_id = $1', [c.id]);
    expect(purchases.length).toBe(0);
  });
});

describe('who may open a picture', () => {
  async function setup() {
    const owner = await newCustomer();
    const id = await project(owner);
    await P.requestSketch(owner, id);
    await P.requestSketch(owner, id);
    await W.drainAll();
    const vs = (await P.versionsOf(id)).filter((v) => v.status === 'ready');
    expect(vs.length).toBe(2);
    return { owner, id, a: vs[0], b: vs[1] };
  }
  const get = async (versionId: string, qs = '') => {
    const { GET } = await import('../app/api/studio/v/[id]/route');
    return GET(new Request(`http://localhost/api/studio/v/${versionId}${qs}`), { params: Promise.resolve({ id: versionId }) });
  };

  it('opens a preview for its owner, with no caching, and hides it from everyone else', async () => {
    const { owner, a } = await setup();
    who.customer = null;
    expect((await get(a.id)).status).toBe(404);
    who.customer = await newCustomer();
    expect((await get(a.id)).status).toBe(404);
    who.customer = owner;
    const ok = await get(a.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toMatch(/no-store/);
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await sharp(Buffer.from(await ok.arrayBuffer())).metadata()).width).toBeGreaterThan(100);
  });

  it('never serves a print file, PDF or vector file of a free sketch, even to its owner', async () => {
    const { owner, a } = await setup();
    who.customer = owner;
    for (const k of ['final', 'pdf', 'svg', 'art', 'raw', '../x']) expect((await get(a.id, `?k=${k}`)).status, k).toBe(404);
  });

  it('lets a share link open only the one design that was shared, and only as a preview', async () => {
    const { owner, id, a, b } = await setup();
    expect(await P.setShared(owner, id, a.id)).toBe(true);
    const p = (await P.getProject(id))!;
    who.customer = null;
    expect((await get(a.id, `?s=${p.share_token}`)).status).toBe(200);
    expect((await get(b.id, `?s=${p.share_token}`)).status).toBe(404);
    expect((await get(a.id, `?s=${p.share_token}&k=final`)).status).toBe(404);
    expect((await get(a.id, '?s=not-the-token')).status).toBe(404);
    await P.setShared(owner, id, null);
    expect((await get(a.id, `?s=${p.share_token}`)).status).toBe(404);
  });

  it('lets only the people who check designs open someone else\'s design', async () => {
    const { a } = await setup();
    who.staff = { id: 's1', email: 'x@y.z', name: 'Disp', role: 'dispatcher', press_id: null };
    expect((await get(a.id)).status).toBe(404);
    who.staff = { id: 's2', email: 'x@y.z', name: 'Desk', role: 'file_desk', press_id: null };
    expect((await get(a.id)).status).toBe(200);
    who.staff = { id: 's3', email: 'x@y.z', name: 'Lead', role: 'production_lead', press_id: null };
    expect((await get(a.id)).status).toBe(200);
  });

  it('ignores ids that are not ids', async () => {
    for (const bad of ['abc', '../../etc/passwd', 'x'.repeat(36), '']) expect((await get(bad)).status).toBe(404);
  });
});

describe('export and erase', () => {
  it('exports a person\'s designs without storage keys, and erases words, pictures and pack designs', async () => {
    const { exportStudio, eraseStudio } = await import('../lib/studio/privacy');
    const c = await newCustomer();
    const id = await project(c);
    await P.addAsset(c, id, 'photo', { name: 'me.jpg', buf: await photo() });
    await P.requestSketch(c, id);
    await W.drainAll();
    await db.query('insert into studio_wallets (customer_id, standard_credits) values ($1, 2) on conflict (customer_id) do update set standard_credits = 2', [c.id]);
    const out: any = await exportStudio(c.id);
    expect(out.projects.length).toBe(1);
    expect(out.uploaded_pictures.length).toBe(1);
    expect(out.saved_pack_designs).toBe(2);
    expect(JSON.stringify(out)).not.toMatch(/storage_key|preview_key|art_key|\.webp|\.png/);
    await eraseStudio(c.id);
    const after: any = await exportStudio(c.id);
    expect(after.uploaded_pictures.length).toBe(0);
    expect(after.saved_pack_designs).toBe(0);
    const left = await db.query<any>('select status, title, brief from studio_projects where id = $1', [id]);
    expect(left[0].status).toBe('purged');
    expect(left[0].title).toBe('');
    expect(JSON.stringify(left[0].brief ?? {})).not.toContain('Adéwálé');
    expect((await db.query('select 1 from studio_versions where project_id = $1', [id])).length).toBe(0);
  });
});

describe('the five-minute sweep', () => {
  it('forgets old sketch records and reports what it did', async () => {
    const { runStudioSweep } = await import('../lib/studio/sweep');
    const c = await newCustomer();
    await db.query("insert into studio_sketch_log (customer_id, phone, at) values ($1, $2, now() - interval '90 days')", [c.id, c.phone]);
    const out = await runStudioSweep();
    expect(out).toMatchObject({ purged: expect.any(Number), recovered: expect.any(Number), applied: expect.any(Number) });
    expect(out.sketchLogs).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Vendor adapters, against replies shaped like each vendor's documentation. These prove the requests we build and the
// replies we read; they cannot prove the vendors still behave this way. That is what the bake-off script is for.
// ---------------------------------------------------------------------------------------------------------------------
const png = () => sharp({ create: { width: 1024, height: 1448, channels: 3, background: '#12307A' } }).png().toBuffer();
type Call = { url: string; headers: Record<string, string>; body: any };
function mockWeb(handler: (url: string, call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: any, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as any).forEach((v, k) => { headers[k.toLowerCase()] = v; });
    let body: any = init?.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* keep text */ } }
    const call = { url: String(u), headers, body };
    calls.push(call);
    return handler(String(u), call);
  }));
  return calls;
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const image = async () => new Response(new Uint8Array(await png()), { status: 200, headers: { 'content-type': 'image/png' } });

describe('picture makers, with mocked replies', () => {
  const input = async () => {
    const { buildArt, defaultBrief } = await import('../lib/studio/prompts');
    const { paletteById } = await import('../content/studio');
    const brief = { ...defaultBrief('owambe'), look: 'plenty gold, ankara', style: 'ankara', palette: 'royal-gold' };
    return buildArt({ brief, spec: { printWIn: 5.83, printHIn: 8.27, productName: 'Flyer', slug: 'flyers' }, variation: 0, palette: paletteById('royal-gold'), hasPhoto: false, hasLogo: false, seed: 7 });
  };

  it('Recraft: sends the key, the model and a size it accepts, then fetches the picture it points to', async () => {
    process.env.RECRAFT_API_KEY = 'rk_test';
    const { ENGINES } = await import('../lib/studio/providers/catalog');
    const { recraftGenerate } = await import('../lib/studio/providers/vendors');
    const calls = mockWeb(async (u) => (u.includes('recraft.ai') ? json({ data: [{ url: 'https://cdn.recraft.example/a.png' }] }) : image()));
    const raw = await recraftGenerate(ENGINES.recraft, await input());
    expect(calls[0].url).toBe('https://external.api.recraft.ai/v1/images/generations');
    expect(calls[0].headers.authorization).toBe('Bearer rk_test');
    expect(calls[0].body.model).toBe('recraftv4');
    expect(ENGINES.recraft.sizes!.map(([w, h]) => `${w}x${h}`)).toContain(calls[0].body.size);
    expect(calls[0].body.negative_prompt).toMatch(/text/);
    expect((await sharp(raw.image).metadata()).width).toBe(1024);
  });

  it('Recraft: reads a picture sent inline as well', async () => {
    process.env.RECRAFT_API_KEY = 'rk_test';
    const { ENGINES } = await import('../lib/studio/providers/catalog');
    const { recraftGenerate } = await import('../lib/studio/providers/vendors');
    mockWeb(async () => json({ data: [{ b64_json: (await png()).toString('base64') }] }));
    expect((await recraftGenerate(ENGINES.recraft, await input())).mime).toBe('image/png');
  });

  it('FLUX: starts a job, waits for it, and downloads the result', async () => {
    process.env.BFL_API_KEY = 'bk_test';
    const { ENGINES } = await import('../lib/studio/providers/catalog');
    const { fluxGenerate } = await import('../lib/studio/providers/vendors');
    let polls = 0;
    const calls = mockWeb(async (u) => {
      if (u.startsWith('https://api.bfl.ai/v1/flux-pro-1.1')) return json({ id: 'job1', polling_url: 'https://api.bfl.ai/v1/get_result?id=job1' });
      if (u.includes('get_result')) return ++polls < 2 ? json({ status: 'Pending' }) : json({ status: 'Ready', result: { sample: 'https://delivery.bfl.example/x.png' } });
      return image();
    });
    const raw = await fluxGenerate(ENGINES.flux, await input());
    expect(calls[0].headers['x-key']).toBe('bk_test');
    expect(calls[0].body.width % 32).toBe(0);
    expect(calls[0].body.height % 32).toBe(0);
    expect(Math.max(calls[0].body.width, calls[0].body.height)).toBeLessThanOrEqual(1440);
    expect(polls).toBe(2);
    expect(raw.image.length).toBeGreaterThan(1000);
  });

  it('FLUX: a moderated request is final, with a plain message for the customer', async () => {
    process.env.BFL_API_KEY = 'bk_test';
    const { ENGINES } = await import('../lib/studio/providers/catalog');
    const { fluxGenerate } = await import('../lib/studio/providers/vendors');
    mockWeb(async (u) => (u.includes('get_result') ? json({ status: 'Content Moderated' }) : json({ id: 'j', polling_url: 'https://api.bfl.ai/v1/get_result?id=j' })));
    const err: any = await fluxGenerate(ENGINES.flux, await input()).catch((e) => e);
    expect(err.retryable).toBe(false);
    expect(err.userMessage).toMatch(/could not be made/i);
  });

  it('Google: asks for one image at a ratio it supports and reads the inline picture', async () => {
    process.env.GEMINI_API_KEY = 'gk_test';
    const { ENGINES } = await import('../lib/studio/providers/catalog');
    const { geminiGenerate } = await import('../lib/studio/providers/vendors');
    const calls = mockWeb(async () => json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: (await png()).toString('base64') } }] } }] }));
    const raw = await geminiGenerate(ENGINES['nano-banana'], await input());
    expect(calls[0].url).toContain('gemini-3-pro-image-preview:generateContent');
    expect(calls[0].headers['x-goog-api-key']).toBe('gk_test');
    expect(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']).toContain(calls[0].body.generationConfig.imageConfig.aspectRatio);
    expect(calls[0].body.generationConfig.responseModalities).toEqual(['IMAGE']);
    expect(raw.mime).toBe('image/png');
  });

  it('Google: a safety stop is final and explained; a reply with no picture and no reason may be retried', async () => {
    process.env.GEMINI_API_KEY = 'gk_test';
    const { ENGINES } = await import('../lib/studio/providers/catalog');
    const { geminiGenerate } = await import('../lib/studio/providers/vendors');
    mockWeb(async () => json({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }));
    const stopped: any = await geminiGenerate(ENGINES['nano-banana'], await input()).catch((e) => e);
    expect(stopped.retryable).toBe(false);
    expect(stopped.userMessage).toMatch(/different way/i);
    mockWeb(async () => json({ candidates: [{ content: { parts: [{ text: 'sorry' }] } }] }));
    const empty: any = await geminiGenerate(ENGINES['nano-banana'], await input()).catch((e) => e);
    expect(empty.retryable).toBe(true);
  });

  it('OpenAI: sends a size from its list and reads the base64 picture', async () => {
    process.env.OPENAI_API_KEY = 'ok_test';
    const { ENGINES } = await import('../lib/studio/providers/catalog');
    const { openaiGenerate } = await import('../lib/studio/providers/vendors');
    const calls = mockWeb(async () => json({ data: [{ b64_json: (await png()).toString('base64') }] }));
    await openaiGenerate(ENGINES['gpt-image'], await input());
    expect(calls[0].headers.authorization).toBe('Bearer ok_test');
    expect(['1024x1024', '1536x1024', '1024x1536']).toContain(calls[0].body.size);
    expect(calls[0].body.model).toBe('gpt-image-1');
  });

  it('treats a bad key as final and never retries it', async () => {
    process.env.OPENAI_API_KEY = 'wrong';
    const { ENGINES } = await import('../lib/studio/providers/catalog');
    const { openaiGenerate } = await import('../lib/studio/providers/vendors');
    const calls = mockWeb(async () => json({ error: { message: 'Incorrect API key provided' } }, 401));
    const err: any = await openaiGenerate(ENGINES['gpt-image'], await input()).catch((e) => e);
    expect(err.retryable).toBe(false);
    expect(calls.length).toBe(1);
  });

  it('follows only https links to the public internet when fetching a vendor\'s picture', async () => {
    const { download } = await import('../lib/studio/providers/http');
    const calls = mockWeb(async () => image());
    for (const u of ['http://cdn.example.com/a.png', 'https://localhost/a.png', 'https://127.0.0.1/a.png', 'https://169.254.169.254/latest/meta-data', 'https://10.0.0.5/a.png', 'https://192.168.1.2/a.png', 'ftp://x.example.com/a', 'not a url']) {
      await expect(download(u), u).rejects.toThrow();
    }
    expect(calls.length).toBe(0);
    expect((await download('https://cdn.example.com/a.png')).mime).toBe('image/png');
  });

  it('keeps the customer\'s words and photos out of what is sent abroad', async () => {
    process.env.RECRAFT_API_KEY = 'rk_test';
    const c = await newCustomer();
    const id = await project(c);
    await P.addAsset(c, id, 'photo', { name: 'me.jpg', buf: await photo() });
    const calls = mockWeb(async (u) => (u.includes('recraft.ai') ? json({ data: [{ url: 'https://cdn.recraft.example/a.png' }] }) : image()));
    const r: any = await P.requestSketch(c, id);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    await W.drainAll();
    const sent = calls.filter((x) => x.url.includes('recraft.ai'));
    expect(sent.length).toBeGreaterThanOrEqual(1);
    const everything = JSON.stringify(sent.map((x) => x.body));
    for (const secret of ['Adéwálé', 'Ọláńrewájú', 'Eko Hotel', '0803 765 4321', '765 4321', '60th Birthday', 'RSVP']) expect(everything, secret).not.toContain(secret);
    expect(everything).toContain('gold');
    // No upload of the customer's picture to the vendor: nothing but JSON text went out.
    expect(sent.every((x) => typeof x.body === 'object' && !(x.body instanceof FormData))).toBe(true);
    const done = (await P.versionsOf(id)).filter((v) => v.kind === 'sketch');
    expect(done[0].status).toBe('ready');
  });

  it('falls to the next picture maker when the first is down, but never shops a refused request around', async () => {
    process.env.RECRAFT_API_KEY = 'rk_test';
    process.env.BFL_API_KEY = 'bk_test';
    const { generateArt } = await import('../lib/studio/engine');
    const s = await S.getSettings();
    // Recraft answers with a server error (retried once, then given up on); FLUX works.
    let calls = mockWeb(async (u) => {
      if (u.includes('recraft.ai')) return json({ error: 'down' }, 503);
      if (u.startsWith('https://api.bfl.ai/v1/flux')) return json({ id: 'j', polling_url: 'https://api.bfl.ai/v1/get_result?id=j' });
      if (u.includes('get_result')) return json({ status: 'Ready', result: { sample: 'https://delivery.bfl.example/x.png' } });
      return image();
    });
    const ok = await generateArt(await input(), ['recraft', 'flux'], { free: false }, s);
    expect(ok.engine).toBe('flux');
    expect(ok.simulated).toBe(false);
    expect(calls.some((c) => c.url.includes('recraft.ai'))).toBe(true);

    // Recraft refuses the request on content grounds: FLUX must not be asked.
    calls = mockWeb(async (u) => (u.includes('recraft.ai') ? json({ error: { message: 'Request blocked by content safety policy' } }, 400) : image()));
    const err: any = await generateArt(await input(), ['recraft', 'flux'], { free: false }, s).catch((e) => e);
    expect(err.retryable).toBe(false);
    expect(calls.some((c) => c.url.includes('bfl.ai'))).toBe(false);
  });
});

describe('Studio stays closed on a live site with no picture maker', () => {
  it('is closed with no key and open with one, and always open in demo mode', async () => {
    const cfg = await import('../lib/studio/config');
    const real = process.env.DEMO_MODE;
    try {
      process.env.DEMO_MODE = 'false';
      expect(cfg.runnable()).toBe(false);
      process.env.RECRAFT_API_KEY = 'rk_test';
      expect(cfg.runnable()).toBe(true);
      delete process.env.RECRAFT_API_KEY;
      process.env.DEMO_MODE = 'true';
      expect(cfg.runnable()).toBe(true);
    } finally {
      if (real === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = real;
    }
  });
});

describe('the Setup page knows about Studio', () => {
  it('lists the picture makers, fonts and safety checks, and warns when a live site has no key', async () => {
    const { setupChecks } = await import('../lib/setup');
    const live = await setupChecks({ DEMO_MODE: 'false', NODE_ENV: 'production' } as any);
    const studio = live.checks.filter((c) => c.group === 'Brandit Studio');
    expect(studio.map((c) => c.id)).toEqual(expect.arrayContaining(['studio-keys', 'studio-fonts', 'studio-moderation', 'studio-access', 'studio-review']));
    expect(studio.find((c) => c.id === 'studio-keys')!.status).toBe('warn');
    expect(studio.find((c) => c.id === 'studio-fonts')!.status).toBe('ok');
    const keyed = await setupChecks({ DEMO_MODE: 'false', NODE_ENV: 'production', RECRAFT_API_KEY: 'k', OPENAI_API_KEY: 'k' } as any);
    expect(keyed.checks.find((c) => c.id === 'studio-keys')!.status).toBe('ok');
    expect(keyed.checks.find((c) => c.id === 'studio-moderation')!.status).toBe('ok');
  });
});
