/*
 * Emails to our own team, and the emails customers get in place of paid WhatsApp messages.
 * Nothing in here touches the database or the network, so the alert that fires when the database is down can still be
 * built, and every part of it can be tested on its own.
 */

/** Used when nobody has typed an address in Business details and ALERT_EMAILS is not set. */
export const DEFAULT_TEAM_EMAILS = ['hello@thebrandit.ng', 'sales@thebrandit.ng'];
export const MAX_TEAM_EMAILS = 6;

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

/** Split what was typed (commas, spaces, semicolons or new lines) into addresses, lower-cased and without repeats. */
export function parseEmails(raw: unknown): { ok: string[]; bad: string[] } {
  const ok: string[] = [];
  const bad: string[] = [];
  for (const part of String(raw ?? '').split(/[\s,;]+/)) {
    const e = part.trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL.test(e)) bad.push(part.trim());
    else if (!ok.includes(e)) ok.push(e);
  }
  return { ok, bad };
}

/** Who gets the team's emails: what was typed in Business details, else ALERT_EMAILS, else the two Brandit mailboxes. */
export function teamEmailsFrom(typed: unknown, env: NodeJS.ProcessEnv = process.env): string[] {
  const a = parseEmails(typed).ok;
  if (a.length) return a.slice(0, MAX_TEAM_EMAILS);
  const b = parseEmails(env.ALERT_EMAILS).ok;
  if (b.length) return b.slice(0, MAX_TEAM_EMAILS);
  return [...DEFAULT_TEAM_EMAILS];
}

export type TeamAlert = {
  /** Short machine name: order_paid, custom_request, event_plan, claim_opened, at_risk, studio_review, site_alert. */
  kind: string;
  subject: string;
  /** The one sentence that matters. */
  headline: string;
  /** Label and value pairs shown under the headline. A value may have several lines. */
  rows: [string, string][];
  link?: string;
  linkLabel?: string;
  /** The customer's own email, so replying to the alert writes to them. */
  replyTo?: string | null;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const teamText = (a: TeamAlert) =>
  [a.headline, '', ...a.rows.map(([k, v]) => `${k}: ${v.includes('\n') ? '\n  ' + v.split('\n').join('\n  ') : v}`), ...(a.link ? ['', `${a.linkLabel ?? 'Open in the console'}: ${a.link}`] : [])].join('\n');

export function teamHtml(a: TeamAlert): string {
  const rows = a.rows
    .map(([k, v]) => `<tr><td style="padding:8px 14px 8px 0;font-size:14px;color:#3D5166;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:8px 0;font-size:16px;font-weight:700;vertical-align:top">${esc(v).replace(/\n/g, '<br>')}</td></tr>`)
    .join('');
  const btn = a.link ? `<tr><td style="padding:8px 32px 28px"><a href="${esc(a.link)}" style="display:inline-block;padding:14px 22px;border-radius:12px;font-weight:700;font-size:16px;text-decoration:none;background:#FFC400;color:#0B1F33">${esc(a.linkLabel ?? 'Open in the console')}</a></td></tr>` : '';
  return `<!doctype html><html><body style="margin:0;background:#F3F5F7;font-family:Arial,Helvetica,sans-serif;color:#0B1F33">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F7;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #D9DFE5;border-radius:16px">
<tr><td style="padding:24px 32px 0;font-size:13px;font-weight:700;letter-spacing:1px;color:#3D5166;text-transform:uppercase">Brandit team alert</td></tr>
<tr><td style="padding:8px 32px 0;font-size:24px;font-weight:800;line-height:1.2">${esc(a.headline)}</td></tr>
${rows ? `<tr><td style="padding:16px 32px 8px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table></td></tr>` : ''}
${btn}
</table>
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px"><tr><td style="padding:16px 8px;font-size:13px;color:#3D5166;text-align:center">You get this because this address is on the team alert list in Business details.</td></tr></table>
</td></tr></table></body></html>`;
}

/** The alert email for the short team messages that used to go only to a phone. */
export function teamMailFor(template: string, vars: Record<string, string>, base: string): TeamAlert {
  switch (template) {
    case 'at_risk':
      return { kind: 'at_risk', subject: `At risk of being late: order ${vars.code}`, headline: `Order ${vars.code} may arrive late.`, rows: [['Order', vars.code ?? ''], ['Promised', vars.arrive ?? ''], ['Stage', vars.stage ?? '']], link: `${base}/console/queue`, linkLabel: 'Open the job queue' };
    case 'custom_alert':
      return { kind: 'custom_request', subject: `New custom request ${vars.code}`, headline: 'A new custom request arrived.', rows: [['Request', vars.code ?? ''], ['From', vars.who ?? ''], ['What', vars.title ?? '']], link: `${base}/console/custom`, linkLabel: 'Open custom quotes' };
    case 'studio_review_alert':
      return { kind: 'studio_review', subject: 'A Studio design is waiting for a check', headline: 'A Studio design is waiting for a person to check it.', rows: [['Design', vars.title ?? '']], link: vars.link || `${base}/console/studio/review`, linkLabel: 'Open the Studio queue' };
    default:
      return { kind: 'site_alert', subject: 'Brandit site alert', headline: vars.what ?? 'Something on the site needs attention.', rows: [], link: `${base}/console/setup`, linkLabel: 'Open Setup' };
  }
}

// ---------- Emails to customers (what used to be a paid WhatsApp message) ----------

const SUBJECT: Record<string, string> = {
  paid: 'Paid: we have started on your order',
  file_checked: 'Your file is checked and ready to print',
  file_problem: 'Action needed: a problem with your file',
  proof_ready: 'Your proof is ready. Please approve it',
  printing: 'Your order is printing now',
  out_for_delivery: 'Your order is on its way',
  ready_for_pickup: 'Your order is ready for pickup',
  delivered: 'Your order has been delivered',
  review_request: 'How did we do?',
  late_refund: 'Sorry, your order is late',
  late_notice: 'Sorry, your order is late',
  new_time: 'Your arrival time has changed',
  reprint_started: 'We are reprinting your order',
  refund_issued: 'Your refund is on its way',
  claim_rejected: 'About the problem you reported',
  custom_received: 'We have your custom request',
  custom_quote_ready: 'Your price is ready',
  custom_declined: 'About your custom request',
  abandoned_nudge: 'Your Brandit order is waiting for you',
  referral_reward: 'You earned a reward',
  rider_nearby: 'Your rider is nearly there',
  pay_link: 'Your Brandit order is ready to pay',
  reorder_reminder: 'Time to print again?',
  reorder_weekly: 'Your weekly reorder reminder',
  sample_credit: 'Your sample pack credit',
  studio_ready: 'Your Brandit Studio designs are ready',
  studio_checked: 'A Brandit designer checked your design',
  studio_changes: 'A note from a Brandit designer',
  studio_refund: 'Your Brandit Studio refund',
  studio_feedback: 'Someone looked at your design',
  studio_credit: 'Your design credit',
};
export const subjectFor = (template: string) => SUBJECT[template] ?? 'An update from Brandit';

/** Turn the web addresses in a plain message into links. The text is escaped first. */
export function linkify(text: string): string {
  return esc(text).replace(/(https?:\/\/[^\s<]*[^\s<.,;:!?)\]])/g, (u) => `<a href="${u}" style="color:#0B1F33;font-weight:700">${u}</a>`);
}

export function customerMail(i: { template: string; body: string; logo?: string }): { subject: string; text: string; html: string } {
  const subject = subjectFor(i.template);
  const text = `${i.body}\n\nBrandit. Printing without the hassle.\nReply to this email if you need a person.`;
  const html = `<!doctype html><html><body style="margin:0;background:#F3F5F7;font-family:Arial,Helvetica,sans-serif;color:#0B1F33">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F7;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:1px solid #D9DFE5;border-radius:16px">
${i.logo ? `<tr><td style="padding:28px 32px 8px"><img src="${esc(i.logo)}" alt="Brandit" height="32" style="height:32px;width:auto;display:block"></td></tr>` : ''}
<tr><td style="padding:16px 32px 4px;font-size:20px;font-weight:800;line-height:1.25">${esc(subject)}</td></tr>
<tr><td style="padding:8px 32px 28px;font-size:16px;line-height:1.55">${linkify(i.body).replace(/\n/g, '<br>')}</td></tr>
</table>
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px"><tr><td style="padding:16px 8px;font-size:13px;color:#3D5166;text-align:center">Brandit. Printing without the hassle.<br>Reply to this email if you need a person.</td></tr></table>
</td></tr></table></body></html>`;
  return { subject, text, html };
}
