/*
 * Tells the owner about the few things that must never wait until someone happens to look:
 * a payment Paystack took that we could not match to an order, a database that will not open, a backup that failed.
 *
 * It sends one short message to ALERT_PHONE (WhatsApp, or SMS if WhatsApp is not set up or fails) and also records the
 * problem in Sentry. It does not use the database, so it still works when the database is the thing that broke.
 * The same problem is sent at most once every 30 minutes, so a bad hour is one message, not two hundred.
 * It never throws: an alert that fails must not make the original problem worse.
 */
import { sendStaffNow } from './messages';
import { reportError, scrub } from './errorReport';

export const ALERT_REPEAT_MINUTES = 30;

const lastSent = new Map<string, number>();
export const resetSiteAlertMemory = () => lastSent.clear();

export type SiteAlert = {
  /** What the problem is, so the same problem is not sent twice in a row. For example "database" or "payment:BR-1042". */
  key: string;
  /** One or two plain sentences saying what happened and what it means. No secrets, no customer details. */
  what: string;
  /** The error behind it, if there was one. Goes to Sentry only. */
  error?: unknown;
  /** Wait this long before sending the same problem again. */
  repeatMinutes?: number;
};
export type SiteAlertResult = {
  sent: boolean;
  channel: 'whatsapp' | 'sms' | 'none';
  skipped?: 'repeat' | 'no-number' | 'no-channel';
  error?: string;
};

/** WhatsApp template values cannot hold line breaks or long runs of spaces, and a text should stay short. */
export const oneLine = (text: string, max = 220) => {
  const t = scrub(text).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

export async function siteAlert(a: SiteAlert, env: NodeJS.ProcessEnv = process.env, doFetch: typeof fetch = fetch, now = Date.now()): Promise<SiteAlertResult> {
  try {
    const what = oneLine(a.what);
    console.error(`[brandit] ALERT ${a.key}: ${what}`);
    // Sentry first and always: it has its own repeat guard, and it keeps a record even when no phone number is set.
    await reportError(a.error ?? new Error(what), { routePath: `alert: ${a.key}`, routeType: 'alert' }, env, doFetch, now).catch(() => false);

    const phone = env.ALERT_PHONE?.trim();
    if (!phone) return { sent: false, channel: 'none', skipped: 'no-number' };
    const wait = (a.repeatMinutes ?? ALERT_REPEAT_MINUTES) * 60_000;
    const before = lastSent.get(a.key);
    if (before !== undefined && now - before < wait) return { sent: false, channel: 'none', skipped: 'repeat' };
    lastSent.set(a.key, now);
    if (lastSent.size > 200) for (const [k, t] of lastSent) if (now - t > 86_400_000) lastSent.delete(k);

    const r = await sendStaffNow(phone, 'site_alert', { what }, env, doFetch);
    if (!r.ok) {
      console.error(`[brandit] could not send the alert by phone: ${r.error}`);
      return { sent: false, channel: 'none', skipped: /Neither/.test(r.error ?? '') ? 'no-channel' : undefined, error: r.error };
    }
    return { sent: true, channel: r.channel, error: r.error };
  } catch (e) {
    return { sent: false, channel: 'none', error: (e as Error)?.message ?? String(e) };
  }
}

/** The plain-words reason a payment Paystack reported could not be applied. */
export function paymentProblem(reason: string): string {
  switch (reason) {
    case 'UNKNOWN_REFERENCE': return 'we have no order with this payment reference';
    case 'AMOUNT_MISMATCH': return 'the amount paid is not the amount of the order';
    case 'ORDER_STATE': case 'STATE': return 'the order was already paid or was cancelled';
    default: return `the check said ${reason.toLowerCase().replace(/_/g, ' ')}`;
  }
}

/** A verified Paystack payment that we could not apply. Money may have left a customer's account, so someone must look. */
export function alertPaymentNotApplied(reference: string, reason: string, env: NodeJS.ProcessEnv = process.env, doFetch: typeof fetch = fetch) {
  const ref = reference.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40);
  return siteAlert({
    key: `payment:${ref}`,
    what: `Paystack took payment ${ref} but we could not apply it: ${paymentProblem(reason)}. Check this payment in the console and in Paystack, and tell the customer.`,
  }, env, doFetch);
}

let downSince: number | null = null;
let toldDown = false;
export const resetDatabaseWatch = () => { downSince = null; toldDown = false; };

/**
 * Feed this the result of each database check. A single failed check is often a blip, so it only says "down" once the
 * database has failed continuously for two minutes, and it says "recovered" once afterwards.
 */
export function watchDatabase(ok: boolean, now = Date.now(), graceMs = 120_000): 'down' | 'recovered' | null {
  if (ok) {
    const was = toldDown;
    downSince = null;
    toldDown = false;
    return was ? 'recovered' : null;
  }
  downSince ??= now;
  if (now - downSince >= graceMs) { toldDown = true; return 'down'; }
  return null;
}
