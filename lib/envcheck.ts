/*
 * The settings check that needs nothing else: no database, no Node-only modules. Because it has no imports it can run in
 * the middleware (which is how a half-set-up site answers with a page that says what is missing, instead of a bare 500)
 * as well as when the server starts.
 */

/**
 * Demo mode shows sign-in codes on screen, fakes payments and creates demo staff with a known PIN.
 * It is on by default only while developing. In production it must be asked for explicitly,
 * so forgetting a setting can never switch it on.
 */
export const isDemoEnv = (env: NodeJS.ProcessEnv) => {
  if (env.DEMO_MODE === 'true') return true;
  if (env.DEMO_MODE === 'false') return false;
  return env.NODE_ENV !== 'production';
};

/** The private test copy of the site (APP_ENV=staging): not indexed, behind a password, and its payments are Paystack test payments. */
export const isStaging = (env: NodeJS.ProcessEnv) => env.APP_ENV === 'staging';

/** True on Vercel: no disk that keeps files, and every request may land on a different short-lived copy of the server. */
export const onVercel = (env: NodeJS.ProcessEnv) => !!env.VERCEL;

/**
 * The database address. Vercel's Neon integration sets both a pooled DATABASE_URL and a direct DATABASE_URL_UNPOOLED;
 * Brandit needs the direct one, because its database locks do not survive a transaction pooler.
 */
export function databaseUrl(env: NodeJS.ProcessEnv): string {
  return env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL || '';
}

/** The host name inside a database address, or '' if there is none. Never the password. */
export function dbHost(url: string): string {
  if (!url) return '';
  try { return new URL(url).hostname; } catch { return /@([^/:?#]+)/.exec(url)?.[1] ?? ''; }
}

/** Render's internal addresses are a bare name such as dpg-abc123-a, with no dots. They only work inside Render. */
export const isRenderInternal = (host: string) => /^dpg-[a-z0-9]+-[a-z]$/i.test(host);

/** SSL for the database. Render refuses outside connections without SSL, so its external address always gets it. */
export function dbSsl(env: NodeJS.ProcessEnv): false | { rejectUnauthorized: false } {
  if (/\.render\.com$/i.test(dbHost(databaseUrl(env)))) return { rejectUnauthorized: false };
  return env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false };
}

/**
 * What must be right for the site to start at all. An empty list means go ahead.
 * Nothing here ever includes a value, only the names of the settings.
 */
export function envProblems(env: NodeJS.ProcessEnv): string[] {
  const p: string[] = [];
  const url = databaseUrl(env);
  if (env.NODE_ENV === 'production' && env.DEMO_MODE === 'true' && url) {
    p.push('DEMO_MODE is true while DATABASE_URL is set. Demo mode is for trying things on your own computer, and it is refused next to a real database. Set DEMO_MODE to false.');
  }
  if (isDemoEnv(env)) {
    if (onVercel(env) && !url) p.push('Vercel has no disk that keeps files, so the built-in database cannot run there. Set DATABASE_URL to a hosted Postgres database.');
    return p;
  }
  if ((env.SESSION_SECRET ?? '').length < 16) p.push('SESSION_SECRET must be set to a long random string (16 characters or more).');
  if (!url) p.push('DATABASE_URL must point to a hosted Postgres database. The built-in local database is for trying things out only.');
  else if (!env.RENDER && isRenderInternal(dbHost(url))) {
    p.push('DATABASE_URL is Render\'s Internal Database URL, which only works for services running inside Render. In Render, open the database, click Connect, choose External, and copy that address instead: its host ends in ".render.com".');
  }
  return p;
}

/** Plain-words advice for the errors a hosted database most often gives on a first deploy. Undefined when there is nothing useful to add. */
export function dbHint(err: unknown, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const e = (err ?? {}) as { code?: string; message?: string; hostname?: string };
  const msg = String(e.message ?? '');
  const code = String(e.code ?? '');
  if (code === 'ENOTFOUND' || /ENOTFOUND/.test(msg)) {
    const host = e.hostname ?? /ENOTFOUND\s+(\S+)/.exec(msg)?.[1] ?? '';
    if (/^dpg-[a-z0-9]+-[a-z]$/i.test(host)) {
      return 'DATABASE_URL is Render\'s Internal Database URL. That address only works for services running inside Render. Copy the External Database URL instead: its host ends in ".render.com".';
    }
    return 'The database host name was not found. Check DATABASE_URL for a typo, and that you copied the whole address.';
  }
  if (code === '28P01' || /password authentication failed/i.test(msg)) return 'The database refused the user name or password in DATABASE_URL. Copy the address again from your database provider.';
  if (code === '3D000' || /database ".*" does not exist/i.test(msg)) return 'The database name at the end of DATABASE_URL does not exist. Copy the address again from your database provider.';
  if (code === '53300' || /too many (connections|clients)|remaining connection slots/i.test(msg)) return 'The database has no free connections. Set DATABASE_POOL_MAX to a smaller number (for example 2), or use your provider\'s direct connection address.';
  if (/does not support SSL/i.test(msg)) return 'This database does not use SSL. Set DATABASE_SSL to false.';
  if (/self[- ]signed|certificate|SSL/i.test(msg)) return 'The SSL handshake failed. Set DATABASE_SSL to true (hosted databases) or false (a database with no SSL).';
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) {
    if (env.RENDER) return 'The database refused the connection. On Render, check that the database is running (its Events tab), and that DATABASE_URL still comes from the database (Environment tab, "from database"), not a pasted copy.';
    return onVercel(env)
      ? 'The database refused the connection. Check the host and port in DATABASE_URL. Vercel connects from changing addresses, so the database must accept connections from anywhere (on Render: the database\'s Info page, Networking, must allow 0.0.0.0/0).'
      : 'The database refused the connection. Check the host and port in DATABASE_URL, and that the database is running.';
  }
  if (code === 'ETIMEDOUT' || /ETIMEDOUT|timeout|timed out|terminated/i.test(msg)) {
    if (env.RENDER) return 'The database did not answer in time. On Render, the web service and the database must be in the same region (Frankfurt) and DATABASE_URL must be the database\'s Internal address, which the Blueprint sets for you. Check that the database is running (its Events tab).';
    return onVercel(env)
      ? 'The database did not answer in time. Check that the database is running, that DATABASE_URL is its External address, and that it accepts connections from anywhere (Vercel connects from changing addresses; on Render, the database\'s Networking section must allow 0.0.0.0/0).'
      : 'The database did not answer in time. Check that it is running and that DATABASE_URL is right.';
  }
  return undefined;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The page a half-set-up site shows. Names of settings only, never values. */
export function setupPage(problems: string[], env: NodeJS.ProcessEnv): string {
  const where = onVercel(env) ? 'In Vercel, open the project, then Settings, then Environment Variables. Add or fix the settings below, then redeploy: a change does not reach the running site until you do.' : 'Add or fix the settings below in your host\'s environment settings, then restart or redeploy the site.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Brandit is not set up yet</title><style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0b0b0c;color:#f4f4f5;display:grid;min-height:100vh;place-items:center;padding:24px}main{max-width:560px}h1{font-size:22px;margin:0 0 8px}p{margin:0 0 14px;color:#c9c9cf}li{margin:0 0 8px}code{background:#1c1c20;padding:1px 6px;border-radius:4px}.box{background:#151518;border:1px solid #2a2a30;border-radius:10px;padding:16px 18px}small{color:#8e8e98}</style></head><body><main><h1>Brandit is not set up yet</h1><p>The site is switched off until its settings are complete. If you are a customer, please check back shortly.</p><div class="box"><p><strong>For the site owner</strong></p><p>${esc(where)}</p><ul>${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><small>Step by step: DEPLOY.md${onVercel(env) ? ', "Path D: Vercel"' : ''}.</small></div></main></body></html>`;
}
