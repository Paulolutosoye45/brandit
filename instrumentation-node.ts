import { startup } from './lib/startup';

/** Node-only startup: check the settings, open the database, start the five-minute check. Skipped while `next build` runs. */
export async function runStartup() {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  await startup();
}
