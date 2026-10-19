'use server';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { cleanEmail, isEmail } from '@/lib/otp';
import { testEmail, testStorage, testPaystack, testAlert, type TestResult } from '@/lib/connections';
import { runBackup, runRestoreTest } from '@/lib/backup';
import { loadLaunchPrices, previewLaunchPrices } from '@/lib/launchPrices';
import { trail } from '@/lib/trail';

const back = (r: TestResult): never => redirect(`/console/setup?${r.ok ? 'ok' : 'e'}=${encodeURIComponent(r.message)}#tests`);

/** Sends one real email through Resend, so you know sign-in codes and receipts will arrive. */
export async function testEmailAction(fd: FormData) {
  const me = await requireStaff('see_setup');
  const to = cleanEmail(String(fd.get('to') ?? '')) || me.email;
  if (!isEmail(to)) return back({ ok: false, message: 'That does not look like an email address.' });
  return back(await testEmail(to));
}

/** Saves, reads back and deletes a tiny file in the artwork bucket. */
export async function testStorageAction() {
  await requireStaff('see_setup');
  return back(await testStorage());
}

/** Asks Paystack for one bank, to prove the key is accepted. No money moves. */
export async function testPaystackAction() {
  await requireStaff('see_setup');
  return back(await testPaystack());
}

/** Sends one test error to Sentry, to see an alert arrive. */
export async function testAlertAction() {
  await requireStaff('see_setup');
  return back(await testAlert());
}

const mb = (n: number) => (n < 1_048_576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1_048_576).toFixed(1)} MB`);

/** Takes a backup now, instead of waiting for the night. */
export async function backupNowAction() {
  await requireStaff('see_setup');
  const r = await runBackup();
  if (r.ok) await trail({ area: 'settings', action: 'backup_now', summary: 'Took a backup by hand' });
  return back(r.ok
    ? { ok: true, message: `Backed up ${r.rows.toLocaleString('en-NG')} rows from ${r.tables} tables (${mb(r.bytes)}) in ${Math.max(1, Math.round(r.ms / 1000))} seconds. The stored copy was read back and matches.` }
    : { ok: false, message: `The backup failed: ${r.error}` });
}

/** Restores the newest backup into a scratch database and checks every row and the money. Touches nothing live. */
export async function restoreTestAction() {
  await requireStaff('see_setup');
  const r = await runRestoreTest();
  return back(r.ok
    ? { ok: true, message: `Restore test passed. ${r.backup} came back whole: ${r.rows.toLocaleString('en-NG')} rows in ${r.tables} tables, and the money added up. This took ${Math.max(1, Math.round(r.ms / 1000))} seconds and changed nothing live.` }
    : { ok: false, message: `Restore test failed: ${r.error}` });
}

const plural = (n: number, w: string) => `${n.toLocaleString('en-NG')} ${w}${n === 1 ? '' : 's'}`;

/** Shows what the launch price book would change, and saves nothing. */
export async function previewLaunchAction() {
  await requireStaff('see_setup');
  const r = await previewLaunchPrices();
  if (!r.ok) return back({ ok: false, message: `The launch price book does not fit this catalogue, so nothing would be saved: ${r.problems.slice(0, 3).join(' ')}` });
  const warn = r.belowCost.length ? ` ${plural(r.belowCost.length, 'price')} would sit below a cost: ${r.belowCost.slice(0, 2).join('; ')}${r.belowCost.length > 2 ? '…' : ''}.` : '';
  return back({ ok: true, message: `Preview: it would change ${plural(r.products.length, 'product')} (${plural(r.readLines, 'line')} read, ${plural(r.unchanged, 'line')} already the same). Nothing was saved yet.${warn}` });
}

/** Loads the launch price book. All or nothing. */
export async function loadLaunchAction() {
  const me = await requireStaff('see_setup');
  const r = await loadLaunchPrices(me.name);
  if (r.ok) await trail({ area: 'catalogue', action: 'launch_prices', summary: `Loaded the launch price book (${r.products.length} products changed)` });
  return back(r.ok
    ? { ok: true, message: `Launch price book loaded: ${plural(r.products.length, 'product')} changed. Customers can now see these prices, and every change is in "Who changed what" under Products.` }
    : { ok: false, message: `Nothing was saved: ${r.problems.slice(0, 3).join(' ')}` });
}
