/*
 * The after-deploy check: ten quick questions a person would otherwise answer by clicking round the live site. It uses only
 * public pages and one price quote. It places no order, signs nobody in and changes nothing. Run it after every deploy:
 *     npm run smoke -- https://thebrandit.ng
 * For the private test site add --staging and --password <the team password>. Add --allow-demo to run it against a
 * trial copy on your own computer.
 *
 * Add --deep --cron-secret <CRON_SECRET> to also ask the site whether it can do its job: save and read back a file, ask
 * Paystack, check the newest backup and the last late-order check. Add --full to also start one unpaid N100 Paystack payment,
 * and --email you@example.com to send one real email and see whether it arrives.
 */

export type Row = { name: string; status: 'pass' | 'fail' | 'warn'; detail: string };
export type Options = {
  staging?: boolean; allowDemo?: boolean; password?: string; fetchImpl?: typeof fetch; slowMs?: number;
  /** Also run the deep health check. `secret` is the site's CRON_SECRET. */
  deep?: { secret: string; full?: boolean; email?: string };
};

const SLOW_MS = 3000;

export async function runSmoke(base: string, opts: Options = {}): Promise<Row[]> {
  const root = base.replace(/\/+$/, '');
  const f = opts.fetchImpl ?? fetch;
  const slow = opts.slowMs ?? SLOW_MS;
  const rows: Row[] = [];
  const add = (name: string, status: Row['status'], detail: string): void => { rows.push({ name, status, detail }); };
  const auth: Record<string, string> = opts.password ? { Authorization: `Basic ${Buffer.from(`team:${opts.password}`).toString('base64')}` } : {};

  const get = async (path: string, init: RequestInit = {}, timeoutMs = 15_000) => {
    const t0 = Date.now();
    const res = await f(path.startsWith('http') ? path : `${root}${path}`, { redirect: 'manual', ...init, headers: { ...auth, ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(timeoutMs) });
    return { res, ms: Date.now() - t0 };
  };
  const timing = (ms: number) => (ms > slow ? ` (slow: ${ms} ms)` : ` (${ms} ms)`);
  const attempt = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { add(name, 'fail', `Could not complete: ${(e as Error)?.message ?? e}`); }
  };

  // 1. The health check
  await attempt('Health check', async () => {
    const { res, ms } = await get('/api/health');
    const body = await res.json().catch(() => null) as any;
    if (res.status === 401) return add('Health check', 'fail', 'Answered 401: the test-site password was refused. Check --password.');
    if (res.status !== 200 || !body?.ok) return add('Health check', 'fail', `Status ${res.status}${body?.problem ? `: ${body.problem}` : ''}`);
    if (body.db !== 'up') return add('Health check', 'fail', 'The database is not up.');
    if (!opts.allowDemo && body.mode !== 'live') return add('Health check', 'fail', `The site is in ${body.mode} mode. Real customers need DEMO_MODE=false.`);
    const want = opts.staging ? 'staging' : 'production';
    if (body.site && body.site !== want) return add('Health check', 'fail', `This is the ${body.site} site, but you asked for ${want}.`);
    add('Health check', ms > slow ? 'warn' : 'pass', `Site and database are up${body.build ? `, build ${body.build}` : ''}${timing(ms)}`);
  });

  // 2. The home page
  let locked = false;
  await attempt('Home page', async () => {
    const { res, ms } = await get('/');
    const html = await res.text();
    if (res.status === 401) { locked = true; return add('Home page', 'fail', 'Status 401: the test site wants its team password, and it is missing or wrong. Use --password.'); }
    if (res.status !== 200) return add('Home page', 'fail', `Status ${res.status}`);
    if (!/Brandit/.test(html)) return add('Home page', 'fail', 'The page loaded but does not say Brandit.');
    add('Home page', ms > slow ? 'warn' : 'pass', `Loads${timing(ms)}`);
    // 3. Headers
    const h = res.headers;
    const missing = [h.get('x-content-type-options') !== 'nosniff' && 'X-Content-Type-Options', root.startsWith('https') && !h.get('strict-transport-security') && 'Strict-Transport-Security'].filter(Boolean);
    const robots = h.get('x-robots-tag') ?? '';
    if (opts.staging && !/noindex/.test(robots)) add('Search engines', 'fail', 'The test site does not tell search engines to stay away.');
    else if (!opts.staging && /noindex/.test(robots)) add('Search engines', 'fail', 'The real site says noindex, so Google would never list it. Is APP_ENV=staging set by mistake?');
    else add('Search engines', 'pass', opts.staging ? 'The test site says noindex.' : 'The real site is open to search engines.');
    add('Safety headers', missing.length ? 'fail' : 'pass', missing.length ? `Missing: ${missing.join(', ')}` : 'Present');
  });

  if (locked) return rows;   // everything else would only repeat the same 401

  // 4. Plain http goes to https
  if (/^https:\/\/(?!localhost|127\.)/.test(root)) {
    await attempt('Redirect to https', async () => {
      const { res } = await get(root.replace(/^https:/, 'http:') + '/', { headers: {} });
      const to = res.headers.get('location') ?? '';
      add('Redirect to https', [301, 302, 307, 308].includes(res.status) && to.startsWith('https://') ? 'pass' : 'fail', [301, 302, 307, 308].includes(res.status) ? `Goes to ${to.replace(/^(https:\/\/[^/]+).*/, '$1')}` : `Plain http answered ${res.status} instead of redirecting`);
    });
  }

  // 5. robots and the sitemap, then a product page and a price from the sitemap
  let slug: string | undefined;
  await attempt('Sitemap', async () => {
    const { res } = await get('/sitemap.xml');
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    if (res.status !== 200 || !locs.length) return add('Sitemap', 'fail', `Status ${res.status}, ${locs.length} addresses`);
    const wrongHost = locs.filter((l) => !l.startsWith(root)).length;
    slug = locs.map((l) => /\/products\/([^/?#]+)$/.exec(l)?.[1]).find(Boolean);
    add('Sitemap', wrongHost && !opts.allowDemo ? 'warn' : 'pass', `${locs.length} addresses${wrongHost ? `, ${wrongHost} not on ${root} (is NEXT_PUBLIC_APP_URL right?)` : ''}`);
  });
  await attempt('robots.txt', async () => {
    const { res } = await get('/robots.txt');
    const txt = await res.text();
    const blocksAll = /^\s*Disallow:\s*\/\s*$/m.test(txt);
    if (res.status !== 200) return add('robots.txt', 'fail', `Status ${res.status}`);
    if (opts.staging) return add('robots.txt', blocksAll ? 'pass' : 'fail', blocksAll ? 'Blocks everything, as a test site should.' : 'The test site does not block search engines.');
    add('robots.txt', blocksAll ? 'fail' : /Sitemap:/i.test(txt) ? 'pass' : 'warn', blocksAll ? 'Blocks the whole site from Google!' : /Sitemap:/i.test(txt) ? 'Open, with the sitemap listed.' : 'Open, but no Sitemap line.');
  });
  if (slug) {
    const s = slug;
    await attempt('Product page', async () => {
      const { res, ms } = await get(`/products/${s}`);
      add('Product page', res.status === 200 ? (ms > slow ? 'warn' : 'pass') : 'fail', `${s}: status ${res.status}${timing(ms)}`);
    });
    await attempt('Price quote', async () => {
      const { res, ms } = await get('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: s, quantity: 100, config: {} }) });
      const body = await res.json().catch(() => null) as any;
      if (res.status !== 200 || !body) return add('Price quote', 'fail', `Status ${res.status}`);
      add('Price quote', body.ok === false ? 'warn' : ms > slow ? 'warn' : 'pass', body.ok === false ? `The price engine answered, but refused 100 of ${s}: ${String(body.message ?? '').slice(0, 80)}` : `The price engine answered${timing(ms)}`);
    });
  }

  // 6. Errors are pages, not crashes
  await attempt('Missing page', async () => {
    const { res } = await get('/this-page-does-not-exist-smoke');
    add('Missing page', res.status === 404 ? 'pass' : 'fail', res.status === 404 ? 'Shows the "not found" page' : `Status ${res.status} (should be 404)`);
  });

  // 7. The console is closed to strangers, and has no demo hints
  await attempt('Console sign-in', async () => {
    // /console may bounce through a couple of redirects (to the queue, then to sign-in). Follow them as a stranger would.
    let at = '/console';
    let status = 0;
    for (let hop = 0; hop < 5; hop++) {
      const { res } = await get(at);
      status = res.status;
      const to = res.headers.get('location');
      if ([301, 302, 303, 307, 308].includes(res.status) && to) { at = to.replace(/^https?:\/\/[^/]+/, ''); continue; }
      break;
    }
    const locked = /^\/console\/login/.test(at) && status === 200;
    if (!locked) return add('Console sign-in', 'fail', `/console answered ${status} (at ${at.split('?')[0]}) to a stranger instead of sending them to sign in.`);
    const page = await get('/console/login');
    const html = await page.res.text();
    const demoHint = /admin@brandit\.test|PIN 1234|demo staff/i.test(html);
    if (page.res.status !== 200) return add('Console sign-in', 'fail', `Sign-in page status ${page.res.status}`);
    if (demoHint && !opts.allowDemo) return add('Console sign-in', 'fail', 'The sign-in page shows demo accounts. DEMO_MODE must be false.');
    if (/No active admin/i.test(html)) return add('Console sign-in', 'fail', 'The sign-in page says there is no active admin. Run: npm run admin -- set <email> <pin>');
    add('Console sign-in', 'pass', 'Closed to strangers; the sign-in page loads.');
  });
  await attempt('Customer sign-in', async () => {
    const { res } = await get('/signin');
    const html = await res.text();
    if (res.status !== 200) return add('Customer sign-in', 'fail', `Status ${res.status}`);
    const methods = [/Continue with Google|Sign in with Google/i.test(html) && 'Google', /type="email"|your email/i.test(html) && 'email', /type="tel"|phone/i.test(html) && 'phone'].filter(Boolean);
    add('Customer sign-in', methods.length ? 'pass' : 'warn', methods.length ? `Offers: ${methods.join(', ')}` : 'The page loads but no sign-in method is visible.');
  });

  // 8. Can it do its job? Asks the site itself to save a file, ask Paystack, look at its backups. Closed to anyone without the secret.
  if (opts.deep) {
    const d = opts.deep;
    await attempt('Deep checks', async () => {
      const q = new URLSearchParams();
      if (d.full) q.set('full', '1');
      if (d.email) q.set('email', d.email);
      const { res } = await get(`/api/health/deep${q.size ? `?${q}` : ''}`, { headers: { Authorization: `Bearer ${d.secret}` } }, 90_000);
      if (res.status === 401) return add('Deep checks', 'fail', 'Answered 401: the CRON_SECRET was refused. It must be the same value the site has.');
      if (res.status === 404) return add('Deep checks', 'fail', 'The site has no deep check yet. Deploy the latest version first.');
      const body = await res.json().catch(() => null) as { checks?: { label: string; ok: boolean; skipped?: boolean; detail: string; ms: number }[] } | null;
      if (!body?.checks) return add('Deep checks', 'fail', `Status ${res.status} with no list of checks.`);
      for (const c of body.checks) add(`Deep: ${c.label}`, c.ok ? 'pass' : 'fail', `${c.detail}${c.skipped ? '' : ` (${c.ms} ms)`}`);
    });
  }

  return rows;
}

export const failed = (rows: Row[]) => rows.filter((r) => r.status === 'fail').length;

export function formatRows(rows: Row[]): string {
  const mark = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' } as const;
  const w = Math.max(...rows.map((r) => r.name.length));
  const lines = rows.map((r) => `  ${mark[r.status]}  ${r.name.padEnd(w)}  ${r.detail}`);
  const f = failed(rows), wn = rows.filter((r) => r.status === 'warn').length;
  return `${lines.join('\n')}\n\n${f ? `${f} check${f > 1 ? 's' : ''} FAILED. Do not announce the site yet.` : wn ? `All clear, with ${wn} thing${wn > 1 ? 's' : ''} to look at.` : 'All clear.'}`;
}
