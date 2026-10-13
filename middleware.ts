import { NextResponse } from 'next/server';
import { envProblems, setupPage } from './lib/envcheck';

/**
 * If the settings the site cannot run without are missing, answer every page with a page that says which ones, instead of a
 * bare "500 Internal Server Error". It reads settings only: no database, no Node-only modules, and it does nothing at all
 * on a site that is set up properly.
 */
export function middleware() {
  const problems = envProblems(process.env);
  if (!problems.length) return NextResponse.next();
  return new NextResponse(setupPage(problems, process.env), {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60', 'X-Robots-Tag': 'noindex' },
  });
}

// Everything except the built files Next serves itself.
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
