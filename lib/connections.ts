import { putFile, getFile, deleteFile, s3On } from './storage';
import { sendStaffNow } from './messages';
import { parseDsn, reportError } from './errorReport';

/*
 * One-press tests for the three connections that cannot be checked by looking at a setting: email, file storage and
 * Paystack. Each answers in plain words, never with a key, and says what to change when it fails.
 */

export type TestResult = { ok: boolean; message: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Resend's refusals, in words a shop owner can act on. */
export function emailProblem(status: number, body: string): string {
  const b = body.toLowerCase();
  if (/testing emails|own email address/.test(b)) return 'Resend is still in testing mode: it only sends to the email address you signed up with. Add and verify your domain in Resend (Domains), then set EMAIL_FROM to an address on that domain.';
  if (status === 401 || /api key is invalid|missing_api_key|invalid_api_key/.test(b)) return 'Resend does not accept RESEND_API_KEY. In Resend open API Keys, make a new key with "Sending access", and paste it again with no spaces.';
  if (/not verified/.test(b)) return 'Resend has not verified the domain in EMAIL_FROM yet. Open Domains in Resend: every record it lists (SPF, DKIM) must be added in your DNS and show "Verified". It can take up to a few hours.';
  if (status === 422 || /invalid.*from|from.*invalid|`from`/.test(b)) return 'EMAIL_FROM is not in a form Resend accepts. Use exactly: Brandit <hello@yourdomain.ng>';
  if (status === 429) return 'Resend says we are sending too fast. Wait a minute and try again.';
  if (status === 403) return 'Resend refused to send. Check that EMAIL_FROM is on a domain you have verified in Resend.';
  return `Resend answered with an error (${status}). Check the key and EMAIL_FROM.`;
}

export function testEmailContent(appUrl: string) {
  const text = `This is a test from your Brandit console. If you can read it, sign-in codes and receipts will reach customers.\n\nSent from ${appUrl}.`;
  const html = `<!doctype html><html><body style="margin:0;background:#F3F5F7;font-family:Arial,Helvetica,sans-serif;color:#0B1F33;padding:32px 16px"><div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #D9DFE5;border-radius:16px;padding:28px 32px"><img src="${esc(appUrl)}/brand/logo-horizontal.png" alt="Brandit" height="32" style="height:32px;width:auto;display:block;margin-bottom:12px"><p style="font-size:20px;font-weight:800;margin:0 0 8px">Your email is connected.</p><p style="font-size:16px;line-height:1.5;margin:0">This is a test from your Brandit console. If you can read it, sign-in codes and receipts will reach customers.</p></div></body></html>`;
  return { subject: 'Brandit test: your email is connected', text, html };
}

const DELIVERED = new Set(['delivered', 'opened', 'clicked']);
const REFUSED: Record<string, string> = {
  bounced: 'refused it (it bounced). Check the address is spelt right and the mailbox exists.',
  complained: 'marked it as spam.',
  suppressed: 'is on Resend\'s block list, so nothing is sent there. Remove it in Resend, Suppressions, or use another address.',
  failed: 'could not be reached. Resend could not hand it over.',
  canceled: 'was cancelled before it went out.',
};

/** Asks Resend what happened to a message, for up to waitMs. Returns null when it cannot tell (a send-only key cannot read). */
async function emailOutcome(id: string, env: NodeJS.ProcessEnv, doFetch: typeof fetch, waitMs: number, sleep: (ms: number) => Promise<void>): Promise<{ event: string } | null> {
  const until = Date.now() + waitMs;
  let event = 'sent';
  for (;;) {
    try {
      const r = await doFetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(8_000) });
      if (r.status === 401 || r.status === 403) return null;
      if (r.ok) event = String(((await r.json().catch(() => null)) as any)?.last_event ?? event);
    } catch { return null; }
    if (DELIVERED.has(event) || REFUSED[event] || Date.now() >= until) return { event };
    await sleep(2_000);
  }
}

export type EmailTestOptions = { confirm?: boolean; waitMs?: number; sleep?: (ms: number) => Promise<void> };

export async function testEmail(to: string, env: NodeJS.ProcessEnv = process.env, doFetch: typeof fetch = fetch, opts: EmailTestOptions = {}): Promise<TestResult> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { ok: false, message: 'Email is not set up. Add RESEND_API_KEY and EMAIL_FROM in your host\'s environment settings, restart, and try again.' };
  const base = (env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const m = testEmailContent(base);
  let res: Response;
  try {
    res = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: m.subject, html: m.html, text: m.text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, message: 'Could not reach Resend from the server. Try again in a minute.' };
  }
  if (!res.ok) return { ok: false, message: emailProblem(res.status, await res.text().catch(() => '')) };
  const sent = `Test email sent to ${to}. Check the inbox, and the spam folder. If it lands in spam, the domain records in Resend are not all verified yet.`;
  const id = ((await res.json().catch(() => null)) as any)?.id;
  if (!id || opts.confirm === false) return { ok: true, message: sent };
  const out = await emailOutcome(String(id), env, doFetch, opts.waitMs ?? 12_000, opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))));
  if (!out) return { ok: true, message: `${sent} (This key can only send, so Resend will not say whether it arrived: look in the inbox.)` };
  if (DELIVERED.has(out.event)) return { ok: true, message: `Test email sent to ${to} and Resend confirms it was delivered. Check the inbox, and the spam folder. If it lands in spam, the domain records in Resend are not all verified yet.` };
  if (REFUSED[out.event]) return { ok: false, message: `Resend sent the test email, but ${to} ${REFUSED[out.event]}` };
  return { ok: true, message: `${sent} Resend has accepted it but has not confirmed delivery yet (${out.event.replace(/_/g, ' ')}); if it has not arrived in a few minutes, check the domain records in Resend.` };
}

/** What each store's refusal means for the person setting it up. */
export function storageProblem(message: string): string {
  const m = message;
  if (/SignatureDoesNotMatch/.test(m)) return 'The bucket does not accept S3_SECRET_ACCESS_KEY. Copy the Secret Access Key again from the Cloudflare token page (it is shown only once; make a new token if you lost it).';
  if (/InvalidAccessKeyId|\(401/.test(m)) return 'The bucket does not recognise S3_ACCESS_KEY_ID. Copy the Access Key ID again from the Cloudflare token page.';
  if (/NoSuchBucket|\(404/.test(m)) return 'The bucket was not found. Check S3_BUCKET is spelt exactly as in Cloudflare, and that S3_ENDPOINT is only https://<account id>.r2.cloudflarestorage.com, with no bucket name on the end.';
  if (/AccessDenied|\(403/.test(m)) return 'The key is valid but may not use this bucket. In Cloudflare R2, API tokens, check the token has "Object Read & Write" and covers this bucket.';
  if (/fetch failed|ENOTFOUND|ECONN|timeout|abort/i.test(m)) return 'The server could not reach the bucket. Check S3_ENDPOINT for a typo.';
  return `The bucket answered with an error: ${m.replace(/[A-Za-z0-9+/=]{30,}/g, '…')}`;
}

export async function testStorage(): Promise<TestResult> {
  if (!s3On()) return { ok: false, message: 'No bucket is set up, so files go to this server\'s own disk, which is lost when the server is replaced. Add the four S3_ settings (DEPLOY.md, Path A, step 2).' };
  let key: string | undefined;
  const steps: string[] = [];
  try {
    const sent = Buffer.from(`brandit storage test ${new Date().toISOString()}`);
    key = await putFile(sent, 'csv'); steps.push('saved');
    const got = await getFile(key); steps.push('read back');
    if (!got.equals(sent)) return { ok: false, message: 'The file came back different from what was saved. Try again; if it repeats, the bucket is faulty.' };
    await deleteFile(key); steps.push('deleted'); key = undefined;
    return { ok: true, message: 'The bucket works: a small file was saved, read back and deleted.' };
  } catch (e) {
    if (key) await deleteFile(key).catch(() => {});
    return { ok: false, message: `Stopped after: ${steps.join(', ') || 'nothing'}. ${storageProblem(String((e as Error)?.message ?? e))}` };
  }
}

export const paystackMode = (key: string | undefined): 'live' | 'test' | 'unknown' => (key?.startsWith('sk_live_') ? 'live' : key?.startsWith('sk_test_') ? 'test' : 'unknown');

/** What Paystack's refusal to start a payment means for the person setting it up. */
export function paystackStartProblem(status: number, message: string): string {
  const m = message.toLowerCase();
  if (/not.*(activated|approved|enabled)|go live|activate|live mode/.test(m)) return `Paystack accepts the key but will not start a payment yet: "${message.slice(0, 140)}". The business is probably not approved for live payments. Finish the verification in Paystack (Settings, Business profile), then try again.`;
  if (/currency/.test(m)) return `Paystack will not take Naira on this account ("${message.slice(0, 140)}"). Check the account country and currency in Paystack.`;
  if (status === 401) return 'Paystack does not accept this key for starting payments. Copy the Secret key again.';
  return `Paystack accepts the key but would not start a test payment (${status}${message ? `: ${message.slice(0, 140)}` : ''}).`;
}

/**
 * Proves the Paystack key is accepted (asks for one bank, which moves no money), then starts one payment of N100 and does not
 * pay it. That leaves one "abandoned" N100 entry in the Paystack dashboard and proves the account can really take payments.
 */
export async function testPaystack(env: NodeJS.ProcessEnv = process.env, doFetch: typeof fetch = fetch, opts: { initialize?: boolean } = {}): Promise<TestResult> {
  const key = env.PAYSTACK_SECRET_KEY;
  if (!key) return { ok: false, message: 'There is no Paystack key. Add PAYSTACK_SECRET_KEY and restart.' };
  const mode = paystackMode(key);
  if (mode === 'unknown') return { ok: false, message: 'PAYSTACK_SECRET_KEY should start with sk_live_ or sk_test_. Copy the Secret key (not the Public key, which starts pk_) from Paystack, Settings, API Keys & Webhooks.' };
  let res: Response;
  try {
    res = await doFetch('https://api.paystack.co/bank?country=nigeria&perPage=1', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
  } catch {
    return { ok: false, message: 'Could not reach Paystack from the server. Try again in a minute.' };
  }
  if (res.status === 401) return { ok: false, message: 'Paystack does not accept this key. Copy the Secret key again from Paystack, Settings, API Keys & Webhooks.' };
  if (!res.ok) return { ok: false, message: `Paystack answered with an error (${res.status}). Try again in a minute.` };
  const site = (env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

  let started = '';
  if (opts.initialize !== false) {
    const host = (() => { try { return new URL(site).hostname; } catch { return ''; } })();
    const email = `healthcheck@${host && host.includes('.') ? host.replace(/^www\./, '') : 'brandit.ng'}`;
    try {
      const r = await doFetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, amount: 10_000, currency: 'NGN', reference: `HC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, callback_url: `${site || 'https://brandit.ng'}/pay/return`, channels: ['card', 'bank_transfer', 'ussd'], metadata: { healthcheck: true } }),
        signal: AbortSignal.timeout(12_000),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j?.data?.authorization_url) return { ok: false, message: paystackStartProblem(r.status, String(j?.message ?? '')) };
      started = ' It also started one N100 payment and left it unpaid, so there is one "abandoned" N100 entry in Paystack: the account can take payments.';
    } catch {
      return { ok: false, message: 'Paystack accepted the key, but starting a test payment timed out. Try again in a minute.' };
    }
  }
  return {
    ok: true,
    message: mode === 'live'
      ? `Paystack accepts the key, and it is a LIVE key: customers' cards are charged for real.${started} Check the webhook in Paystack points to ${site || 'your site'}/api/webhooks/paystack.`
      : `Paystack accepts the key, and it is a TEST key: no real money moves.${started} Use this on the test site only. Check the webhook in Paystack (test mode) points to ${site || 'your site'}/api/webhooks/paystack.`,
  };
}

/**
 * Sends one harmless test of each way the site can tell you something is wrong: a test error to Sentry (which emails the
 * team), and a test message to ALERT_PHONE by WhatsApp or SMS. Each part says in plain words what to look for.
 */
export async function testAlert(env: NodeJS.ProcessEnv = process.env, doFetch: typeof fetch = fetch): Promise<TestResult> {
  const phone = env.ALERT_PHONE?.trim();
  const sentryHas = !!env.SENTRY_DSN;
  if (!sentryHas && !phone) return { ok: false, message: 'There is no SENTRY_DSN and no ALERT_PHONE, so nothing is sent. For phone alerts set ALERT_PHONE to your number (and SMS_API_KEY or the two WHATSAPP values). For error emails make a free Node.js project at sentry.io, copy its DSN, set SENTRY_DSN, and restart.' };
  const parts: { ok: boolean; text: string }[] = [];
  if (sentryHas) {
    if (!parseDsn(env.SENTRY_DSN)) parts.push({ ok: false, text: 'SENTRY_DSN is not a Sentry address. Copy it again from Sentry, Project settings, Client Keys. It looks like https://abc123@o123.ingest.sentry.io/456.' });
    else {
      const sent = await reportError(new Error(`Brandit test alert from the Setup page, ${new Date().toISOString()}`), { routePath: '/console/setup', routeType: 'test' }, env, doFetch);
      parts.push(sent
        ? { ok: true, text: 'Test alert sent to Sentry. Open Sentry, Issues: a "Brandit test alert" appears within a minute, and Sentry emails the team if email alerts are on.' }
        : { ok: false, text: 'Sentry did not accept the test alert. Check the DSN was copied whole from the right project. (If you pressed this many times in an hour, wait and try again.)' });
    }
  }
  if (phone) {
    const r = await sendStaffNow(phone, 'site_alert', { what: 'This is a test. If you can read it, phone alerts work.' }, env, doFetch);
    parts.push(r.ok
      ? { ok: true, text: r.channel === 'whatsapp' ? `Test message sent to ${phone} on WhatsApp. It should arrive in a few seconds.` : `Test message sent to ${phone} by SMS. It should arrive in a few seconds.${r.error ? ' (WhatsApp did not work, so SMS was used. Check the brandit_site_alert template is approved in Meta.)' : ''}` }
      : { ok: false, text: /Neither/.test(r.error ?? '') ? 'ALERT_PHONE is set but neither SMS nor WhatsApp is, so a phone message cannot be sent. Set SMS_API_KEY (Termii) or the two WHATSAPP values.' : `The phone message could not be sent (${(r.error ?? '').slice(0, 160)}). Check ALERT_PHONE is a full number with country code, and the SMS or WhatsApp keys.` });
  } else {
    parts.push({ ok: true, text: 'No phone alerts yet: set ALERT_PHONE to get a message on your phone for failed payments, a database outage or a failed backup.' });
  }
  return { ok: parts.every((p) => p.ok), message: parts.map((p) => p.text).join(' ') };
}
