import { query, tx, type Q } from './db';
import { render, STAFF_TEMPLATES, TEMPLATES, type Lang, type TemplateKey } from '../content/messages';
import { emailOn, sendEmail } from './email';
import { customerMail, teamEmailsFrom, teamHtml, teamMailFor, teamText, type TeamAlert } from './teamAlerts';
import { outboxWanted } from './outbox';

export const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

type Queue = { orderId?: string | null; toPhone?: string | null; template: TemplateKey; vars: Record<string, string>; lang?: Lang };

/** The wording this customer chose, found from their order or their number. Staff messages are always English. */
async function langFor(q: Q, m: Queue): Promise<Lang> {
  if (m.lang) return m.lang;
  if (STAFF_TEMPLATES.includes(m.template)) return 'en';
  // If the team switched Pidgin off, every message goes out in English.
  const on = await q.query<{ value: unknown }>("select value from settings where key = 'pidgin_enabled'");
  if (on[0] && on[0].value === false) return 'en';
  let r: { lang: string }[] = [];
  if (m.orderId) r = await q.query('select c.lang from orders o join customers c on c.id = o.customer_id where o.id = $1', [m.orderId]);
  else if (m.toPhone) r = await q.query('select lang from customers where phone = $1 or whatsapp_phone = $1 order by last_sign_in_at desc nulls last limit 1', [m.toPhone]);
  return r[0]?.lang === 'pcm' ? 'pcm' : 'en';
}

/** Queue a message inside a transaction. flushMessages() sends it after commit. */
export async function queueMessage(q: Q, m: Queue) {
  const lang = await langFor(q, m);
  const body = render(m.template, m.vars, lang);
  await q.query(
    `insert into messages (order_id, to_phone, template, vars, body, status, lang)
     values ($1, coalesce($2, (select coalesce(c.whatsapp_phone, c.phone) from orders o join customers c on c.id = o.customer_id where o.id = $1)), $3, $4, $5, 'queued', $6)`,
    [m.orderId ?? null, m.toPhone ?? null, m.template, JSON.stringify(m.vars), body, lang],
  );
}

/** The name of the approved WhatsApp template. Pidgin versions end in _pcm and are approved under the English language setting. */
export const whatsappTemplateName = (template: TemplateKey, lang: Lang = 'en') => `brandit_${template}${lang === 'pcm' ? '_pcm' : ''}`;

async function sendWhatsApp(phone: string, template: TemplateKey, vars: Record<string, string>, lang: Lang = 'en', doFetch: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const res = await doFetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: whatsappTemplateName(template, lang),
        language: { code: env.WHATSAPP_TEMPLATE_LANG ?? 'en' },
        components: [{ type: 'body', parameters: TEMPLATES[template].vars.map((k) => ({ type: 'text', text: String(vars[k] ?? '') })) }],
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function sendSms(phone: string, text: string, doFetch: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const res = await doFetch('https://api.ng.termii.com/api/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: phone.replace(/^\+/, ''), from: env.SMS_SENDER_ID ?? 'Brandit', sms: text, type: 'plain', channel: 'generic', api_key: env.SMS_API_KEY }),
  });
  if (!res.ok) throw new Error(`SMS ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export const whatsappOn = (env: NodeJS.ProcessEnv = process.env) => !!(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
export const smsOn = (env: NodeJS.ProcessEnv = process.env) => !!env.SMS_API_KEY;

/**
 * Tell our own team something right now, without the database (the alert has to get out even when the database is the
 * thing that broke). It goes by email to the team addresses when email is set up (free), and to the alert phone by
 * WhatsApp, or SMS if WhatsApp is not set up or fails. Succeeds if any of them got through. Never throws.
 */
export async function sendStaffNow(
  phone: string | null, template: TemplateKey, vars: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env, doFetch: typeof fetch = fetch,
): Promise<{ ok: boolean; channel: 'whatsapp' | 'sms' | 'email' | 'none'; error?: string }> {
  let error: string | undefined;
  let via: 'whatsapp' | 'sms' | 'email' | 'none' = 'none';
  let note: string | undefined;
  if (phone) {
    if (whatsappOn(env)) {
      try { await sendWhatsApp(phone, template, vars, 'en', doFetch, env); via = 'whatsapp'; } catch (e) { error = (e as Error).message; }
    }
    if (via === 'none' && smsOn(env)) {
      try { await sendSms(phone, render(template, vars, 'en'), doFetch, env); via = 'sms'; note = error ? `WhatsApp failed, sent by SMS: ${error}` : undefined; } catch (e) { error = `${error ? error + '; ' : ''}${(e as Error).message}`; }
    }
  }
  if (emailOn(env)) {
    try {
      const a = teamMailFor(template, vars, (env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, ''));
      await sendEmail({ to: teamEmailsFrom(undefined, env), subject: a.subject, html: teamHtml(a), text: teamText(a) }, env, doFetch);
      if (via === 'none') via = 'email';
    } catch (e) { error = `${error ? error + '; ' : ''}Email: ${(e as Error).message}`; }
  }
  if (via === 'none') return { ok: false, channel: 'none', error: error ?? 'Neither WhatsApp nor SMS is set up.' };
  return { ok: true, channel: via, ...(note ? { error: note } : {}) };
}

/** Send an SMS directly (sign-in codes). Returns false when no provider is configured. */
export async function sendDirectSms(phone: string, text: string): Promise<boolean> {
  if (!smsOn()) return false;
  await sendSms(phone, text);
  return true;
}

type Channel = 'whatsapp' | 'sms' | 'demo' | 'email' | 'whatsapp_manual';
type Delivery = { channel: Channel; status: string; error: string | null; alsoOutbox?: boolean };

/** The team's own email, queued with the rest so a failed send can be retried from the console. */
export async function queueTeamAlert(q: Q, a: TeamAlert, orderId: string | null = null) {
  const biz = await q.query<{ value: { alert_emails?: string } | null }>("select value from settings where key = 'business'");
  const to = teamEmailsFrom(biz[0]?.value?.alert_emails);
  await q.query(
    `insert into messages (order_id, audience, to_email, template, vars, body, status, lang) values ($1, 'team', $2, $3, $4, $5, 'queued', 'en')`,
    [orderId, to.join(','), `team_${a.kind}`, JSON.stringify(a), teamText(a)],
  );
}

/** A message to our own team: the alert phone when there is one (as before), and always the team's email. */
export async function queueStaffAlert(q: Q, template: TemplateKey, vars: Record<string, string>) {
  const phone = process.env.ALERT_PHONE?.trim();
  if (phone) await queueMessage(q, { toPhone: phone, template, vars });
  await queueTeamAlert(q, teamMailFor(template, vars, appUrl()));
}

/** Queue one email to the team and send it now. Best effort: it never breaks what the customer was doing. */
export async function notifyTeam(a: TeamAlert, orderId: string | null = null): Promise<void> {
  await tx(async (q) => { await queueTeamAlert(q, a, orderId); });
  await flushMessages(10).catch(() => {});
}

/** Paid WhatsApp Business Platform, kept only for a business that chooses to pay Meta. Free WhatsApp does not use it. */
async function deliverApi(m: any): Promise<Delivery> {
  if (!m.to_phone) return { channel: 'demo', status: 'failed', error: 'No phone number' };
  try {
    if (whatsappOn()) {
      try {
        let error: string | null = null;
        try {
          await sendWhatsApp(m.to_phone, m.template, m.vars, m.lang === 'pcm' ? 'pcm' : 'en');
        } catch (first) {
          // The Pidgin template may not be approved yet. Send the English one rather than lose the message.
          if (m.lang !== 'pcm') throw first;
          await sendWhatsApp(m.to_phone, m.template, m.vars, 'en');
          error = `Pidgin template not available, sent the English one: ${(first as Error).message}`;
        }
        return { channel: 'whatsapp', status: 'sent', error };
      } catch (e) {
        if (!smsOn()) throw e;
        await sendSms(m.to_phone, m.body);
        return { channel: 'sms', status: 'sent', error: `WhatsApp failed, sent by SMS: ${(e as Error).message}` };
      }
    }
    if (smsOn()) {
      await sendSms(m.to_phone, m.body);
      return { channel: 'sms', status: 'sent', error: null };
    }
    console.log(`[message → ${m.to_phone}] ${m.body}`);
    return { channel: 'demo', status: 'logged', error: null };
  } catch (e) {
    return { channel: 'demo', status: 'failed', error: (e as Error).message };
  }
}

/**
 * The free way. Email goes out by itself when the customer has one. SMS is used only if it is set up and there was no
 * email. WhatsApp is never sent by the platform: the message waits in the console for a person to tap send, either
 * because nothing else reached the customer or because the customer needs to act on it.
 */
async function deliverFree(m: any, replyTo: string | null): Promise<Delivery> {
  const hasPhone = !!m.to_phone;
  const notes: string[] = [];
  let channel: Channel = 'demo';
  let auto = false;
  if (m.customer_email && emailOn()) {
    try {
      await sendEmail({ to: m.customer_email, ...customerMail({ template: m.template, body: m.body, logo: `${appUrl()}/brand/logo-horizontal.png` }), replyTo });
      auto = true; channel = 'email';
    } catch (e) { notes.push(`Email failed: ${(e as Error).message}`); }
  }
  if (!auto && hasPhone && smsOn()) {
    try { await sendSms(m.to_phone, m.body); auto = true; channel = 'sms'; } catch (e) { notes.push(`SMS failed: ${(e as Error).message}`); }
  }
  const outbox = outboxWanted(m.template, hasPhone, auto);
  const error = notes.join('; ') || null;
  if (auto) return { channel, status: 'sent', error, alsoOutbox: outbox };
  if (outbox) return { channel: 'whatsapp_manual', status: 'to_send', error };
  return { channel: 'demo', status: 'failed', error: error ?? 'There is no phone number or email to reach this customer.' };
}

async function deliverTeam(m: any): Promise<Delivery> {
  const a = (typeof m.vars === 'string' ? JSON.parse(m.vars) : m.vars) as TeamAlert;
  if (!m.to_email) return { channel: 'demo', status: 'failed', error: 'No team email address' };
  if (!emailOn()) {
    console.log(`[team alert → ${m.to_email}] ${a.subject}`);
    return { channel: 'demo', status: 'logged', error: null };
  }
  try {
    await sendEmail({ to: String(m.to_email).split(','), subject: a.subject, html: teamHtml(a), text: teamText(a), replyTo: a.replyTo ?? null });
    return { channel: 'email', status: 'sent', error: null };
  } catch (e) {
    return { channel: 'demo', status: 'failed', error: (e as Error).message };
  }
}

/**
 * Send everything that is queued. Team emails go by email. A customer's message goes by email, SMS if that is set up, and
 * otherwise waits for a person to send it on WhatsApp. Only a business that sets the paid WhatsApp keys uses Meta.
 */
export async function flushMessages(limit = 25): Promise<number> {
  await query("update messages set status = 'expired' where status = 'to_send' and created_at < now() - interval '3 days'").catch(() => {});
  const rows = await query<any>(
    `select m.id, m.to_phone, m.template, m.vars, m.body, m.lang, m.audience, m.to_email,
            coalesce((select c.email from orders o join customers c on c.id = o.customer_id where o.id = m.order_id),
                     (select c.email from customers c where m.to_phone is not null and (c.phone = m.to_phone or c.whatsapp_phone = m.to_phone) and c.email is not null order by c.last_sign_in_at desc nulls last limit 1),
                     (select r.email from custom_requests r where m.to_phone is not null and r.phone = m.to_phone and r.email is not null order by r.created_at desc limit 1)) as customer_email
       from messages m where m.status = 'queued' order by m.id limit $1`,
    [limit],
  );
  let replyTo: string | null | undefined;
  const reply = async () => {
    if (replyTo === undefined) {
      try {
        const { getBusiness } = await import('./business');
        replyTo = (await getBusiness()).email ?? teamEmailsFrom(undefined)[0];
      } catch { replyTo = teamEmailsFrom(undefined)[0]; }
    }
    return replyTo ?? null;
  };
  let sent = 0;
  for (const m of rows) {
    let d: Delivery;
    if (m.audience === 'team') d = await deliverTeam(m);
    else if (STAFF_TEMPLATES.includes(m.template)) d = await deliverApi(m);
    else if (whatsappOn() && m.to_phone) d = await deliverApi(m);
    else d = await deliverFree(m, await reply());
    if (d.status === 'sent') sent++;
    await query('update messages set channel = $2, status = $3, error = $4, sent_at = $5 where id = $1', [m.id, d.channel, d.status, d.error, d.status === 'to_send' ? null : new Date().toISOString()]);
    if (d.alsoOutbox) {
      await query(
        `insert into messages (order_id, to_phone, channel, template, vars, body, status, lang, audience)
         select order_id, to_phone, 'whatsapp_manual', template, vars, body, 'to_send', lang, 'customer' from messages where id = $1`,
        [m.id],
      );
    }
  }
  return sent;
}
