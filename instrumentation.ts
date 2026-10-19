/**
 * Runs once when the server starts.
 *
 * Next.js bundles this file twice, once for Node and once for the Edge runtime. The check below has to read exactly
 * `process.env.NEXT_RUNTIME === 'nodejs'`: Next swaps in the real value while bundling and drops the whole block from
 * the Edge copy. An early "return" is not enough. The Edge copy then tries to pack the database driver, fails with
 * "Module not found: Can't resolve 'fs'", and in `npm run dev` every page shows an error.
 * Everything that needs Node lives in instrumentation-node.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runStartup } = await import('./instrumentation-node');
    await runStartup();
  }
}

/**
 * Next.js calls this for every server error. It is a separate file so the Edge copy of this hook never reaches the database
 * driver (see the note at the top), and it does nothing unless SENTRY_DSN is set.
 */
export async function onRequestError(err: unknown, request: { path?: string; method?: string }, context: { routePath?: string; routeType?: string }) {
  const { reportRequestError } = await import('./instrumentation-error');
  await reportRequestError(err, request, context);
}
