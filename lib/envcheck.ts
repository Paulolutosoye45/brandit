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
  return sessionModeUrl(cleanUrl(env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL || ''));
}

/** A pasted address often arrives with a space or newline on the end, or inside quotes. Neither is part of the address. */
function cleanUrl(raw: string): string {
  const s = raw.trim();
  return /^(["']).*\1$/.test(s) ? s.slice(1, -1).trim() : s;
}

/**
 * Supabase's shared pooler answers on two ports: 5432 (session mode) and 6543 (transaction mode). Brandit's database locks,
 * which stop two servers refunding the same late order, only hold in session mode. So an address on port 6543 is switched
 * to 5432 (same host, same user, same password) before anything connects.
 */
export function sessionModeUrl(url: string): string {
  return url.replace(/(@[^/?#\s]*\.pooler\.supabase\.com):6543(?=[/?#]|$)/i, '$1:5432');
}

/** The host name inside a database address, or '' if there is none. Never the password. */
export function dbHost(url: string): string {
  if (!url) return '';
  try { return new URL(url).hostname; } catch { return /@([^/:?#]+)/.exec(url)?.[1] ?? ''; }
}

/** Render's internal addresses are a bare name such as dpg-abc123-a, with no dots. They only work inside Render. */
export const isRenderInternal = (host: string) => /^dpg-[a-z0-9]+-[a-z]$/i.test(host);

/** Any Supabase database address: the shared pooler (aws-0-eu-central-1.pooler.supabase.com) or the direct one (db.<ref>.supabase.co). */
export const isSupabaseHost = (host: string) => /\.supabase\.(co|com)$/i.test(host);
/** The shared pooler. Reachable over IPv4, which is what Render and Vercel have. */
export const isSupabasePooler = (host: string) => /\.pooler\.supabase\.com$/i.test(host);
/** The direct address. On the Free plan it only has an IPv6 address, which Render and Vercel cannot reach. */
export const isSupabaseDirect = (host: string) => /^db\.[a-z0-9]+\.supabase\.co$/i.test(host);
/** True when the database address in these settings is a Supabase one. */
export const usingSupabase = (env: NodeJS.ProcessEnv) => isSupabaseHost(dbHost(databaseUrl(env)));

/** The user name inside a database address, or '' if there is none. Never the password. */
export function dbUser(url: string): string {
  try { return decodeURIComponent(new URL(url).username); } catch { return /^[a-z]+:\/\/([^:@/]+)/i.exec(url)?.[1] ?? ''; }
}

/**
 * SSL for the database. Render refuses outside connections without SSL, so its external address always gets it, and so does
 * Supabase's: a leftover DATABASE_SSL=false (the private Render address needed it) must not be able to switch it off.
 */
export function dbSsl(env: NodeJS.ProcessEnv): false | { rejectUnauthorized: false } {
  const host = dbHost(databaseUrl(env));
  if (/\.render\.com$/i.test(host) || isSupabaseHost(host)) return { rejectUnauthorized: false };
  return env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false };
}

/**
 * How the connection pool is set up. Supabase's shared pooler in session mode gives every connection of ours a connection of
 * its own, out of a pool of fixed size (set in Supabase's database settings; I could not read its default), so Brandit keeps
 * its own pool small there: two copies of the server overlap for a few minutes during every deploy.
 * It also sets the 30-second query limit with a SET on each new connection instead of as a start-up setting, because
 * start-up settings are not something a pooler is promised to pass on.
 */
export function poolSettings(env: NodeJS.ProcessEnv): { max: number; limitViaSet: boolean } {
  const host = dbHost(databaseUrl(env));
  const fallback = env.VERCEL ? 4 : isSupabasePooler(host) ? 5 : 10;
  return { max: Math.max(1, Math.min(50, Math.floor(Number(env.DATABASE_POOL_MAX)) || fallback)), limitViaSet: isSupabaseHost(host) };
}

/** Row-level security is switched on for every table at start-up on Supabase (lib/rls.ts). DATABASE_RLS=off or on overrides. */
export function rlsWanted(env: NodeJS.ProcessEnv): boolean {
  if (env.DATABASE_RLS === 'off') return false;
  if (env.DATABASE_RLS === 'on') return true;
  return usingSupabase(env);
}

/** MAINTENANCE=on: customers see a "back in a few minutes" page while the team keeps the console. Used when moving the database. */
export const maintenanceOn = (env: NodeJS.ProcessEnv) => /^(on|true|yes|1)$/i.test((env.MAINTENANCE ?? '').trim());

/**
 * What stays open during maintenance: the health check (so the host keeps the server), the scheduled checks, the team's console
 * and the files it shows. Everything else, including the Paystack webhook, answers 503, so Paystack keeps the payment news
 * and sends it again once the site is back.
 */
export const OPEN_IN_MAINTENANCE = [/^\/api\/health(\/deep)?$/, /^\/api\/cron\//, /^\/console(\/|$)/, /^\/api\/console(\/|$)/, /^\/api\/files(\/|$)/, /^\/robots\.txt$/];
export const staysOpenInMaintenance = (pathname: string) => OPEN_IN_MAINTENANCE.some((r) => r.test(pathname));

/** The page customers see during maintenance. No values, no addresses. */
export function maintenancePage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="60"><title>Back in a few minutes · Brandit</title><style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0b0b0c;color:#f4f4f5;display:grid;min-height:100vh;place-items:center;padding:24px}main{max-width:480px;text-align:center}h1{font-size:24px;margin:0 0 10px}p{margin:0 0 12px;color:#c9c9cf}small{color:#8e8e98}</style></head><body><main><h1>Back in a few minutes</h1><p>We are making a quick upgrade to keep Brandit fast and safe. This page checks again by itself every minute.</p><p>If you were paying just now, your payment is safe and your order will be confirmed once we are back.</p><small>Brandit, Lagos</small></main></body></html>`;
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
  } else if (/\[YOUR-PASSWORD\]|\[PASSWORD\]/i.test(url)) {
    p.push('DATABASE_URL still contains the words [YOUR-PASSWORD]. Replace them, with the square brackets, by your database password.');
  } else if (isSupabaseDirect(dbHost(url)) && (env.RENDER || onVercel(env))) {
    p.push('DATABASE_URL is Supabase\'s direct address (db.<project>.supabase.co). Render cannot reach it, because it only has an IPv6 address on the Free plan. In Supabase press Connect, choose "Session pooler" (port 5432) and copy that address instead: its host ends in ".pooler.supabase.com".');
  } else if (isSupabasePooler(dbHost(url)) && !dbUser(url).includes('.')) {
    p.push('DATABASE_URL uses the plain user name "postgres" with Supabase\'s pooler. The pooler needs "postgres." followed by your project reference, for example postgres.abcdefghijklmnop. In Supabase press Connect, choose "Session pooler" and copy the address again.');
  }
  return p;
}

/** True for the errors a pooler gives when every connection it may hand out is taken. They come before any query is sent, so asking again is safe. */
export const isPoolFull = (err: unknown) => /max clients reached|EMAXCONNSESSION|MaxClientsInSessionMode|remaining connection slots|too many clients|too many connections|max_client_conn/i.test(String((err as { message?: string })?.message ?? ''));

/** Plain-words advice for the errors a hosted database most often gives on a first deploy. Undefined when there is nothing useful to add. */
export function dbHint(err: unknown, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const e = (err ?? {}) as { code?: string; message?: string; hostname?: string };
  const msg = String(e.message ?? '');
  const code = String(e.code ?? '');
  const dbh = dbHost(databaseUrl(env));
  const direct = 'DATABASE_URL is Supabase\'s direct address (db.<project>.supabase.co), which Render cannot reach (IPv6 only on the Free plan). In Supabase press Connect, choose "Session pooler" (port 5432) and copy that address instead.';
  if (isSupabaseDirect(dbh) && /ENETUNREACH|EADDRNOTAVAIL|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|timeout|timed out/i.test(`${code} ${msg}`)) return direct;
  if (/Tenant or user not found|EAUTHFAIL|project (is )?paused/i.test(msg)) return 'Supabase did not recognise the project or the user. Check three things: the user name is "postgres." followed by your project reference (copy it from Connect, Session pooler); the project is not paused (Free projects pause after about a week without use: open the Supabase dashboard and press Resume project); and the address is the Session pooler one, not the direct one.';
  if (isSupabaseHost(dbh) && isPoolFull(e)) return 'Supabase\'s connection pool is full. If this only shows during a deploy, it clears by itself when the old server stops. Otherwise set DATABASE_POOL_MAX to 3 and redeploy, or raise the pool size in Supabase (Project Settings, Database, Connection pooling).';
  if (code === 'ENOTFOUND' || /ENOTFOUND/.test(msg)) {
    const host = e.hostname ?? /ENOTFOUND\s+(\S+)/.exec(msg)?.[1] ?? '';
    if (/^dpg-[a-z0-9]+-[a-z]$/i.test(host)) {
      return 'DATABASE_URL is Render\'s Internal Database URL. That address only works for services running inside Render. Copy the External Database URL instead: its host ends in ".render.com".';
    }
    if (isSupabaseDirect(host)) return direct;
    if (isSupabaseHost(host)) return 'The Supabase host name was not found. The project may be paused (Free projects pause after about a week without use: open the Supabase dashboard and press Resume project), or the address has a typo. Copy it again from Connect, Session pooler.';
    return 'The database host name was not found. Check DATABASE_URL for a typo, and that you copied the whole address.';
  }
  if (code === '28P01' || /password authentication failed/i.test(msg)) return isSupabaseHost(dbh)
    ? 'Supabase refused the password in DATABASE_URL. Type the password in place of [YOUR-PASSWORD] without the square brackets. If you do not remember it, set a new one in Supabase (Project Settings, Database, Reset database password) and paste the new address. Use letters and numbers only, so no symbol can break the address.'
    : 'The database refused the user name or password in DATABASE_URL. Copy the address again from your database provider.';
  if (code === '3D000' || /database ".*" does not exist/i.test(msg)) return 'The database name at the end of DATABASE_URL does not exist. Copy the address again from your database provider.';
  if (code === '53300' || /too many (connections|clients)|remaining connection slots/i.test(msg)) return 'The database has no free connections. Set DATABASE_POOL_MAX to a smaller number (for example 2), or use your provider\'s direct connection address.';
  if (/does not support SSL/i.test(msg)) return 'This database does not use SSL. Set DATABASE_SSL to false.';
  if (/self[- ]signed|certificate|SSL/i.test(msg)) return 'The SSL handshake failed. Set DATABASE_SSL to true (hosted databases) or false (a database with no SSL).';
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) {
    if (isSupabaseHost(dbh)) return 'Supabase refused the connection. Check the port in DATABASE_URL is 5432 (Session pooler), and that the project is not paused: open the Supabase dashboard and press Resume project if it is.';
    if (env.RENDER) return 'The database refused the connection. On Render, check that the database is running (its Events tab), and that DATABASE_URL still comes from the database (Environment tab, "from database"), not a pasted copy.';
    return onVercel(env)
      ? 'The database refused the connection. Check the host and port in DATABASE_URL. Vercel connects from changing addresses, so the database must accept connections from anywhere (on Render: the database\'s Info page, Networking, must allow 0.0.0.0/0).'
      : 'The database refused the connection. Check the host and port in DATABASE_URL, and that the database is running.';
  }
  if (code === 'ETIMEDOUT' || /ETIMEDOUT|timeout|timed out|terminated/i.test(msg)) {
    if (isSupabaseHost(dbh)) return 'Supabase did not answer in time. Check that the project is not paused (Free projects pause after about a week without use: open the Supabase dashboard and press Resume project), that DATABASE_URL is the Session pooler address, and that the project is in Central EU (Frankfurt) beside Render.';
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
