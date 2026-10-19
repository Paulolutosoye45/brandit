import { TEMPLATES, STAFF_TEMPLATES, render, type TemplateKey } from '../content/messages';

/*
 * What the console shows about each message: when it is sent, the sample values used for previews and test sends, and the
 * group it belongs to. The wording itself lives in content/messages.ts, because a WhatsApp message can only say what Meta
 * approved (see WHATSAPP_TEMPLATES.md): changing a word means asking Meta to approve it again, so it is a deliberate change,
 * not something to do from a text box.
 */
export const GROUPS: { title: string; keys: TemplateKey[] }[] = [
  { title: 'Order updates', keys: ['paid', 'file_checked', 'file_problem', 'proof_ready', 'printing', 'out_for_delivery', 'ready_for_pickup', 'rider_nearby', 'delivered', 'new_time', 'review_request'] },
  { title: 'When something goes wrong', keys: ['late_notice', 'late_refund', 'reprint_started', 'refund_issued', 'claim_rejected'] },
  { title: 'Quotes and reminders', keys: ['custom_received', 'custom_quote_ready', 'custom_declined', 'abandoned_nudge', 'pay_link', 'reorder_reminder', 'reorder_weekly', 'sample_credit', 'referral_reward'] },
  { title: 'Studio (AI designs)', keys: ['studio_ready', 'studio_checked', 'studio_changes', 'studio_refund', 'studio_feedback', 'studio_credit'] },
  { title: 'For the team', keys: ['at_risk', 'custom_alert', 'studio_review_alert', 'site_alert'] },
];

export const WHEN: Partial<Record<TemplateKey, string>> = {
  paid: 'The moment a payment is confirmed.',
  file_checked: 'When a person at the file desk passes a customer’s file.',
  file_problem: 'When the file desk finds a problem and the customer must upload again.',
  proof_ready: 'When a proof is sent for the customer to approve.',
  printing: 'When the job moves to printing.',
  out_for_delivery: 'When the rider leaves, with the delivery code.',
  ready_for_pickup: 'When a pickup order is ready to collect.',
  rider_nearby: 'When the rider is about ten minutes away.',
  delivered: 'When the order is marked delivered.',
  new_time: 'When the arrival time changes after payment.',
  review_request: 'A little after delivery, asking for a review.',
  late_notice: 'When an order is running late and there is no delivery fee to refund.',
  late_refund: 'When a 24-hour order is late and the delivery fee is refunded automatically.',
  reprint_started: 'When a problem report is settled with a free reprint.',
  refund_issued: 'Whenever a refund is sent, from a problem report or the Payments page.',
  claim_rejected: 'When a problem report is closed without a reprint or refund.',
  custom_received: 'When a customer sends a custom-order request.',
  custom_quote_ready: 'When the team sends a price for a custom request.',
  custom_declined: 'When the team declines a custom request.',
  abandoned_nudge: 'Once, for a basket with delivery details that was not paid.',
  pay_link: 'When the team builds an order from a WhatsApp chat and chooses to send the pay link from Brandit’s own number.',
  reorder_reminder: 'About 90 days after an order was delivered: “running low?” with a one-tap reorder. Customers can stop it.',
  reorder_weekly: 'Every week, on the morning the customer chose (Thursday by default), for people who asked for a weekly reminder.',
  sample_credit: 'When a sample pack is paid: the fee comes back as money off the first order.',
  referral_reward: 'When a friend’s first order is delivered and the sharer earns a reward.',
  studio_ready: 'When Studio designs are ready to look at.',
  studio_checked: 'When a designer passes a Studio design.',
  studio_changes: 'When a designer leaves a note on a Studio design.',
  studio_refund: 'When a Studio purchase is refunded.',
  studio_feedback: 'When someone the customer shared a design with replies.',
  studio_credit: 'When an approved design earns money off the print.',
  at_risk: 'To the team: an order is at risk of being late.',
  custom_alert: 'To the team: a new custom request arrived.',
  studio_review_alert: 'To the team: a Studio design is waiting for a human check.',
  site_alert: 'To the owner: something on the site needs attention (payment not applied, database, backup).',
};

const SAMPLE: Record<string, string> = {
  code: 'BR-1042', arrive_line: 'It arrives tomorrow by 5pm.', link: 'https://thebrandit.ng/track/sample', staff_name: 'Tunde', issue: 'The picture is too small.', delivery_code: '4821',
  amount: '₦12,500', reason: 'The picture was too small to print sharply.', hours: '24', price: '₦85,000', days: '5', name: 'Chioma', product: 'Business cards', friend: 'Ibrahim',
  stop: 'https://thebrandit.ng/reminders/stop/sample', rider: 'Musa', note: 'The phone number looks wrong.', verdict: 'Love it', title: 'Wedding programme', who: 'Chioma Okafor', arrive: 'tomorrow 5pm', stage: 'quality check', what: 'Payment BR-1042-x could not be applied.',
};
export const sampleVars = (key: TemplateKey): Record<string, string> => Object.fromEntries(TEMPLATES[key].vars.map((v) => [v, SAMPLE[v] ?? v]));
export const preview = (key: TemplateKey, lang: 'en' | 'pcm') => render(key, sampleVars(key), lang);
export const isStaffTemplate = (key: TemplateKey) => STAFF_TEMPLATES.includes(key);
export const allKeys = () => Object.keys(TEMPLATES) as TemplateKey[];
