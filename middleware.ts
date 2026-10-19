import { NextResponse, type NextRequest } from 'next/server';
import { envProblems, setupPage, isStaging } from './lib/envcheck';

/**
 * Two jobs, both settings-only: no database, no Node-only modules.
 *
 * 1. If the settings the site cannot run without are missing, answer every page with a page that says which ones, instead of
 *    a bare "500 Internal Server Error". It does nothing at all on a site that is set up properly.
 * 2. On the private test copy of the site (APP_ENV=staging): tell search engines to stay away, and ask for the team password
 *    (STAGING_PASSWORD) before showing anything. The health check, the Paystack webhook and the scheduled check stay open
 *    because machines call them; each protects itself (a signature, a secret).
 */
const OPEN_ON_TEST_SITE = [/^\/api\/health(\/deep)?$/, /^\/api\/webhooks\//, /^\/api\/cron\//, /^\/robots\.txt$/];

/** Same answer in the same time whether the first or the last character is wrong. */
function same(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function passwordOk(header: string | null, password: string): boolean {
  const m = /^Basic\s+(.+)$/i.exec(header ?? '');
  if (!m) return false;
  let decoded = '';
  try { decoded = atob(m[1]); } catch { return false; }
  const given = decoded.slice(decoded.indexOf(':') + 1);      // the user name is ignored
  return same(given, password);
}

export function middleware(req: NextRequest) {
  const problems = envProblems(process.env);
  if (problems.length) {
    return new NextResponse(setupPage(problems, process.env), {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60', 'X-Robots-Tag': 'noindex' },
    });
  }
  if (!isStaging(process.env)) return NextResponse.next();

  const password = process.env.STAGING_PASSWORD ?? '';
  const open = OPEN_ON_TEST_SITE.some((r) => r.test(req.nextUrl.pathname));
  if (password && !open && !passwordOk(req.headers.get('authorization'), password)) {
    return new NextResponse('This is the Brandit test site. Ask the team for the password.', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Brandit test site", charset="UTF-8"', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }
  const res = NextResponse.next();
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

// Everything except the built files Next serves itself.
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
