/*
 * Tells the owner when the site hits an error, without a heavy add-on. Set SENTRY_DSN (a free Sentry project is enough)
 * and every server error is sent to Sentry's plain web address; Sentry emails the team.
 *
 * It sends the error text, the page address WITHOUT its query string (which can hold codes), and the method. It never
 * sends cookies, headers, form data or the customer's details, and it blanks anything that looks like a database
 * address, a payment or email key, or a bearer token. It uses fetch only, so it runs on the Node and the Edge side alike.
 */

export type Target = { endpoint: string; key: string };

/** A Sentry DSN looks like https://<key>@<host>/<project id>. Anything else means "off". */
export function parseDsn(dsn: string | undefined): Target | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+|\/+$/g, '');
    if (!u.username || !project || !/^\d+$/.test(project.split('/').pop()!)) return null;
    const prefix = project.split('/').slice(0, -1).join('/');
    const id = project.split('/').pop()!;
    return { endpoint: `${u.protocol}//${u.host}${prefix ? `/${prefix}` : ''}/api/${id}/envelope/`, key: u.username };
  } catch { return null; }
}

/** Blank out anything that could be a secret before it leaves the server. */
export function scrub(text: string): string {
  return text
    .replace(/\b(?:postgres(?:ql)?|mysql|redis|https?):\/\/[^\s'"]*:[^\s'"@]*@[^\s'"]+/gi, '[address removed]')
    .replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+/g, '[key removed]')
    .replace(/\bre_[A-Za-z0-9_]{12,}/g, '[key removed]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [removed]')
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, '[removed]');
}

/** The page address without the query string or fragment, and with long ids kept (they are not secrets). */
export function cleanPath(path: string | undefined): string {
  return (path ?? '').split(/[?#]/)[0].slice(0, 300);
}

type Ctx = { routePath?: string; routeType?: string; method?: string; path?: string };

const eventFor = (err: unknown, ctx: Ctx, env: NodeJS.ProcessEnv, id: string, now: Date) => {
  const e = (err ?? {}) as { name?: string; message?: string; stack?: string; digest?: string };
  return {
    event_id: id,
    timestamp: now.getTime() / 1000,
    platform: 'node',
    level: 'error',
    server_name: 'brandit',
    environment: env.APP_ENV === 'staging' ? 'staging' : 'production',
    release: (env.RENDER_GIT_COMMIT || env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || undefined,
    exception: { values: [{ type: scrub(String(e.name ?? 'Error')).slice(0, 100), value: scrub(String(e.message ?? err ?? 'Unknown error')).slice(0, 600) }] },
    request: { url: cleanPath(ctx.path), method: ctx.method },
    tags: { route: ctx.routePath, kind: ctx.routeType, digest: e.digest },
    extra: { stack: scrub(String(e.stack ?? '')).split('\n').slice(0, 14).join('\n') },
  };
};

export function buildEnvelope(err: unknown, ctx: Ctx, dsn: string, env: NodeJS.ProcessEnv, id: string, now = new Date()): string {
  const head = { event_id: id, sent_at: now.toISOString(), dsn };
  return [JSON.stringify(head), JSON.stringify({ type: 'event' }), JSON.stringify(eventFor(err, ctx, env, id, now))].join('\n');
}

const recent = new Map<string, number>();
let sentThisHour: number[] = [];
const SAME_ERROR_PAUSE_MS = 5 * 60_000;
const MAX_PER_HOUR = 30;

/** Send one error. Quiet about repeats (the same error is sent once per five minutes) and capped at 30 an hour, so a fault cannot flood Sentry or slow the site. Never throws. */
export async function reportError(err: unknown, ctx: Ctx = {}, env: NodeJS.ProcessEnv = process.env, doFetch: typeof fetch = fetch, now = Date.now()): Promise<boolean> {
  try {
    const dsn = env.SENTRY_DSN;
    const target = parseDsn(dsn);
    if (!target) return false;
    const e = (err ?? {}) as { message?: string; digest?: string };
    const fingerprint = `${e.digest ?? ''}|${String(e.message ?? err).slice(0, 160)}|${ctx.routePath ?? ''}`;
    const last = recent.get(fingerprint);
    if (last !== undefined && now - last < SAME_ERROR_PAUSE_MS) return false;
    sentThisHour = sentThisHour.filter((t) => now - t < 3_600_000);
    if (sentThisHour.length >= MAX_PER_HOUR) return false;
    recent.set(fingerprint, now);
    if (recent.size > 200) for (const [k, t] of recent) if (now - t > SAME_ERROR_PAUSE_MS) recent.delete(k);
    sentThisHour.push(now);
    const id = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const res = await doFetch(target.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${target.key}, sentry_client=brandit/1` },
      body: buildEnvelope(err, ctx, dsn!, env, id, new Date(now)),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch { return false; }
}

/** For tests. */
export function resetErrorReportMemory() { recent.clear(); sentThisHour = []; }
