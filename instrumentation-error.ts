import { reportError } from './lib/errorReport';

/**
 * Called by Next.js for every error on the server (a page, a route, a form action). It only sends the error to Sentry when
 * SENTRY_DSN is set. It reads settings and uses fetch, nothing Node-only, so the Edge copy of instrumentation.ts can bundle it.
 */
export async function reportRequestError(err: unknown, request: { path?: string; method?: string }, context: { routePath?: string; routeType?: string }) {
  const e = err as { digest?: string; message?: string };
  console.error(`[brandit] Server error${context.routePath ? ` on ${context.routePath}` : ''}${e?.digest ? ` (ref ${e.digest})` : ''}: ${e?.message ?? err}`);
  await reportError(err, { path: request.path, method: request.method, routePath: context.routePath, routeType: context.routeType });
}
