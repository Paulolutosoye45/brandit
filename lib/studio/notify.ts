import { one, query, tx } from '../db';
import { appUrl, flushMessages, queueMessage } from '../messages';
import { naira } from '../money';
import { contactPhone } from '../identity';
import type { TemplateKey } from '../../content/messages';

/* Studio's WhatsApp and SMS messages. A customer with no phone number on file simply gets none: everything is also on the page. */
const linkOf = (projectId: string) => `${appUrl()}/studio/p/${projectId}`;

async function customerOf(projectId: string) {
  return one<{ id: string; phone: string | null; whatsapp_phone: string | null; title: string; tier: string | null; credit_kobo: number }>(
    'select c.id, c.phone, c.whatsapp_phone, p.title, p.tier, p.credit_kobo from studio_projects p join customers c on c.id = p.customer_id where p.id = $1',
    [projectId],
  );
}

export async function send(projectId: string, template: TemplateKey, vars: Record<string, string>) {
  const c = await customerOf(projectId);
  const to = c ? contactPhone(c) : null;
  if (!c || !to) return false;
  await tx(async (q) => { await queueMessage(q, { toPhone: to, template, vars }); });
  await flushMessages(5).catch(() => {});
  return true;
}

export const notifyDesignsReady = (projectId: string) => send(projectId, 'studio_ready', { link: linkOf(projectId) });
export const notifyChecked = (projectId: string) => send(projectId, 'studio_checked', { link: linkOf(projectId) });
export const notifyChanges = (projectId: string, note: string) => send(projectId, 'studio_changes', { note: note.slice(0, 200), link: linkOf(projectId) });
export const notifyRefund = (projectId: string, amountKobo: number, reason: string) => send(projectId, 'studio_refund', { amount: naira(amountKobo), reason });
export const notifyFeedback = (projectId: string, name: string, verdict: string) => send(projectId, 'studio_feedback', { name: name.slice(0, 40), verdict, link: linkOf(projectId) });
export const notifyCredit = (projectId: string, amountKobo: number, days: number) => send(projectId, 'studio_credit', { amount: naira(amountKobo), days: String(days), link: linkOf(projectId) });

/** Tell the team a design is waiting for a person to check. */
export async function notifyReviewRequested(projectId: string) {
  const alertPhone = process.env.ALERT_PHONE ?? null;
  if (!alertPhone) return false;
  const p = await one<{ title: string }>('select title from studio_projects where id = $1', [projectId]);
  await tx(async (q) => { await queueMessage(q, { toPhone: alertPhone, template: 'studio_review_alert', vars: { title: (p?.title || 'A design').slice(0, 60), link: `${appUrl()}/console/studio/review` } }); });
  await flushMessages(5).catch(() => {});
  return true;
}
void query;
