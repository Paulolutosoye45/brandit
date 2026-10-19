import { query, type Q } from './db';
import { render, STAFF_TEMPLATES, TEMPLATES, type Lang, type TemplateKey } from '../content/messages';

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
 * Send one message to our own team right now, without the database (the alert has to get out even when the database is
 * the thing that broke). WhatsApp first, SMS if that fails or is not set up. Never throws.
 */
export async function sendStaffNow(
  phone: string, template: TemplateKey, vars: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env, doFetch: typeof fetch = fetch,
): Promise<{ ok: boolean; channel: 'whatsapp' | 'sms' | 'none'; error?: string }> {
  let error: string | undefined;
  if (whatsappOn(env)) {
    try { await sendWhatsApp(phone, template, vars, 'en', doFetch, env); return { ok: true, channel: 'whatsapp' }; } catch (e) { error = (e as Error).message; }
  }
  if (smsOn(env)) {
    try { await sendSms(phone, render(template, vars, 'en'), doFetch, env); return { ok: true, channel: 'sms', error: error ? `WhatsApp failed, sent by SMS: ${error}` : undefined }; } catch (e) { error = `${error ? error + '; ' : ''}${(e as Error).message}`; }
  }
  return { ok: false, channel: 'none', error: error ?? 'Neither WhatsApp nor SMS is set up.' };
}

/** Send an SMS directly (sign-in codes). Returns false when no provider is configured. */
export async function sendDirectSms(phone: string, text: string): Promise<boolean> {
  if (!smsOn()) return false;
  await sendSms(phone, text);
  return true;
}

/** Send everything that is queued. WhatsApp first, SMS if that fails, a log line if neither is set up. */
export async function flushMessages(limit = 25): Promise<number> {
  const rows = await query<any>("select id, to_phone, template, vars, body, lang from messages where status = 'queued' order by id limit $1", [limit]);
  let sent = 0;
  for (const m of rows) {
    let channel: 'whatsapp' | 'sms' | 'demo' = 'demo';
    let status = 'logged';
    let error: string | null = null;
    if (!m.to_phone) {
      status = 'failed';
      error = 'No phone number';
    } else {
      try {
        if (whatsappOn()) {
          try {
            try {
              await sendWhatsApp(m.to_phone, m.template, m.vars, m.lang === 'pcm' ? 'pcm' : 'en');
            } catch (first) {
              // The Pidgin template may not be approved yet. Send the English one rather than lose the message.
              if (m.lang !== 'pcm') throw first;
              await sendWhatsApp(m.to_phone, m.template, m.vars, 'en');
              error = `Pidgin template not available, sent the English one: ${(first as Error).message}`;
            }
            channel = 'whatsapp';
            status = 'sent';
          } catch (e) {
            if (!smsOn()) throw e;
            await sendSms(m.to_phone, m.body);
            channel = 'sms';
            status = 'sent';
            error = `WhatsApp failed, sent by SMS: ${(e as Error).message}`;
          }
        } else if (smsOn()) {
          await sendSms(m.to_phone, m.body);
          channel = 'sms';
          status = 'sent';
        } else {
          console.log(`[message → ${m.to_phone}] ${m.body}`);
        }
        if (status === 'sent') sent++;
      } catch (e) {
        status = 'failed';
        error = (e as Error).message;
      }
    }
    await query('update messages set channel = $2, status = $3, error = $4, sent_at = now() where id = $1', [m.id, channel, status, error]);
  }
  return sent;
}
