/*
 * The deep health check: not "is the website answering?" (that is /api/health) but "can it do its job?". It saves and reads
 * back a file, asks Paystack, looks at the newest backup and the last late-order check. Run it after every deploy with
 *     npm run smoke -- https://thebrandit.ng --deep --cron-secret <CRON_SECRET>
 * It is closed to the public (same secret as the scheduler). By default it changes nothing and costs nothing. With full=1 it
 * also starts one unpaid N100 Paystack payment and, if you give an address, sends one real email and waits for Resend to say
 * whether it arrived.
 */
import { isDemo, one } from './db';
import { MIGRATIONS } from './schema';
import { s3On } from './storage';
import { paystackOn } from './payments';
import { emailOn } from './email';
import { testEmail, testPaystack, testStorage } from './connections';
import { backupsEnabled, backupStatus } from './backup';

export type DeepCheck = { id: string; label: string; ok: boolean; skipped?: boolean; detail: string; ms: number };
export type DeepOptions = { full?: boolean; email?: string };

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`took longer than ${Math.round(ms / 1000)} seconds`)), ms).unref?.())]);

export async function runDeepHealth(opts: DeepOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<{ ok: boolean; checks: DeepCheck[] }> {
  const demo = isDemo(env);
  const checks: DeepCheck[] = [];
  const run = async (id: string, label: string, fn: () => Promise<{ ok: boolean; detail: string; skipped?: boolean }>, limitMs = 20_000) => {
    const t0 = Date.now();
    try {
      const r = await withTimeout(fn(), limitMs);
      checks.push({ id, label, ...r, ms: Date.now() - t0 });
    } catch (e) {
      checks.push({ id, label, ok: false, detail: `Could not check: ${(e as Error)?.message ?? e}`, ms: Date.now() - t0 });
    }
  };

  await run('database', 'Database', async () => {
    const n = Number((await one<{ n: number }>('select count(*)::int as n from schema_migrations'))?.n ?? 0);
    return n >= MIGRATIONS.length
      ? { ok: true, detail: `Answers, and all ${MIGRATIONS.length} upgrades are applied.` }
      : { ok: false, detail: `Answers, but only ${n} of ${MIGRATIONS.length} upgrades are applied.` };
  });

  await run('storage', 'File storage', async () => {
    if (demo && !s3On()) return { ok: true, skipped: true, detail: 'Skipped: demo mode with no bucket.' };
    const r = await testStorage();
    return { ok: r.ok, detail: r.message };
  });

  await run('paystack', 'Paystack', async () => {
    if (!paystackOn()) return demo ? { ok: true, skipped: true, detail: 'Skipped: demo mode, payments are pretend.' } : { ok: false, detail: 'There is no Paystack key, so nobody can pay.' };
    const r = await testPaystack(env, fetch, { initialize: !!opts.full });
    return { ok: r.ok, detail: r.message };
  }, 30_000);

  await run('email', 'Email', async () => {
    if (!emailOn()) return { ok: true, skipped: true, detail: 'Skipped: email is not set up (customers can still sign in another way).' };
    if (!(opts.full && opts.email)) return { ok: true, skipped: true, detail: 'Skipped: no email was sent. Add --full --email you@example.com to send a real one and see whether it arrives.' };
    const r = await testEmail(opts.email, env);
    return { ok: r.ok, detail: r.message };
  }, 40_000);

  await run('backup', 'Backup', async () => {
    const b = backupsEnabled(env);
    if (!b.on) return demo ? { ok: true, skipped: true, detail: 'Skipped: demo mode.' } : { ok: false, detail: `Backups are not running: ${b.why}.` };
    const s = await backupStatus();
    if (!s.newest) return { ok: false, detail: s.lastFail ? `No backup yet. The last attempt failed: ${s.lastFail.error}` : 'No backup yet. The first one is taken a few minutes after the site starts.' };
    const hours = (Date.now() - s.newest.modified.getTime()) / 3_600_000;
    const restoreOk = !s.restore || s.restore.ok;
    if (hours > 26) return { ok: false, detail: `The newest backup is ${Math.round(hours)} hours old.${s.lastFail ? ` The last attempt failed: ${s.lastFail.error}` : ''}` };
    if (!restoreOk) return { ok: false, detail: `The newest backup is fresh (${Math.max(1, Math.round(hours))} hours), but the last restore test failed: ${s.restore?.error ?? 'unknown'}.` };
    return { ok: true, detail: `Newest backup is ${hours < 1 ? 'less than an hour' : `${Math.round(hours)} hours`} old; ${s.count} daily and ${s.monthly} monthly kept.${s.restore ? ' The last restore test passed.' : ' No restore test yet.'}` };
  });

  await run('sweep', 'Late-order check', async () => {
    const last = await one<{ at: string }>("select max(at) as at from events where name = 'sweep'");
    const mins = last?.at ? Math.round((Date.now() - new Date(last.at).getTime()) / 60_000) : null;
    if (mins != null && mins <= 15) return { ok: true, detail: `Last ran ${mins === 0 ? 'just now' : `${mins} minute${mins > 1 ? 's' : ''} ago`}.` };
    if (demo) return { ok: true, skipped: true, detail: 'Skipped: demo mode.' };
    return { ok: false, detail: mins == null ? 'It has not run yet. It starts about 30 seconds after the site does.' : `Last ran ${mins} minutes ago. It should run every 5.` };
  });

  return { ok: checks.every((c) => c.ok), checks };
}
