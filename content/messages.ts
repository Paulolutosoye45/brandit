// Every customer message, in the Brandit voice: lead with what matters, say what happens next,
// name the person, never make the customer chase. One file, one owner.
export type TemplateKey =
  | 'paid' | 'file_checked' | 'file_problem' | 'proof_ready' | 'printing'
  | 'out_for_delivery' | 'ready_for_pickup' | 'delivered' | 'review_request'
  | 'late_refund' | 'late_notice' | 'new_time' | 'reprint_started' | 'refund_issued'
  | 'claim_rejected' | 'at_risk'
  | 'custom_received' | 'custom_quote_ready' | 'custom_declined' | 'custom_alert'
  | 'abandoned_nudge' | 'referral_reward' | 'rider_nearby'
  | 'studio_ready' | 'studio_checked' | 'studio_changes' | 'studio_refund' | 'studio_feedback' | 'studio_credit' | 'studio_review_alert';

/** en is the default. pcm is Nigerian Pidgin, used only for customers who chose it. */
export type Lang = 'en' | 'pcm';
export const LANGS: Lang[] = ['en', 'pcm'];

type Vars = Record<string, string>;
type Def = { vars: string[]; text: (v: Vars) => string };

export const TEMPLATES: Record<TemplateKey, Def> = {
  paid: {
    vars: ['code', 'arrive_line', 'link'],
    text: (v) => `Paid. We have started on order ${v.code}. Next, a person checks your file. ${v.arrive_line} Track it here: ${v.link}`,
  },
  file_checked: {
    vars: ['staff_name'],
    text: (v) => `${v.staff_name} checked your file. It is ready to print.`,
  },
  file_problem: {
    vars: ['issue', 'link'],
    text: (v) => `We found a problem with your file: ${v.issue} Upload a new one here: ${v.link}. Your delivery clock is paused until then.`,
  },
  proof_ready: {
    vars: ['link'],
    text: (v) => `Your proof is ready. Have a look and approve it here: ${v.link}. Nothing prints until you do.`,
  },
  printing: {
    vars: ['code', 'arrive_line'],
    text: (v) => `Order ${v.code} is printing now. ${v.arrive_line}`,
  },
  out_for_delivery: {
    vars: ['link', 'delivery_code'],
    text: (v) => `Here is your finished job. It is on its way. Track your rider: ${v.link}. Give the rider this code: ${v.delivery_code}`,
  },
  ready_for_pickup: {
    vars: ['link', 'delivery_code'],
    text: (v) => `Here is your finished job. It is ready for pickup. Show this code when you collect it: ${v.delivery_code}. Details: ${v.link}`,
  },
  delivered: {
    vars: ['link'],
    text: (v) => `Delivered. Anything not right? Tell us here: ${v.link}`,
  },
  review_request: {
    vars: ['code', 'link'],
    text: (v) => `How did we do on order ${v.code}? It takes two taps: ${v.link}`,
  },
  late_refund: {
    vars: ['code', 'link'],
    text: (v) => `We are running late on order ${v.code}, and that is on us. Your delivery fee has been refunded. Track it here: ${v.link}`,
  },
  late_notice: {
    vars: ['code', 'link'],
    text: (v) => `We are running late on order ${v.code}, and that is on us. We are on it. Track it here: ${v.link}`,
  },
  new_time: {
    vars: ['arrive_line', 'link'],
    text: (v) => `Your arrival time has changed. ${v.arrive_line} Track it here: ${v.link}`,
  },
  reprint_started: {
    vars: ['code', 'link'],
    text: (v) => `We are reprinting order ${v.code} at no charge. Track it here: ${v.link}`,
  },
  refund_issued: {
    vars: ['amount', 'code'],
    text: (v) => `We have refunded ${v.amount} for order ${v.code}. It can take a few days to show in your account.`,
  },
  claim_rejected: {
    vars: ['code', 'reason'],
    text: (v) => `About order ${v.code}: we looked into your report and cannot reprint or refund this time. ${v.reason} Reply here if you want to talk it through.`,
  },
  at_risk: {
    vars: ['code', 'arrive', 'stage'],
    text: (v) => `Order ${v.code} is at risk. Promised ${v.arrive}, still at ${v.stage}.`,
  },
  custom_received: {
    vars: ['code', 'hours', 'link'],
    text: (v) => `We got your custom request ${v.code}. A person will send you a price within ${v.hours} hours. Check on it any time: ${v.link}`,
  },
  custom_quote_ready: {
    vars: ['code', 'price', 'days', 'link'],
    text: (v) => `Your price for ${v.code} is ready: ${v.price}. It is delivered ${v.days} working days after you approve your proof. See the details and accept here: ${v.link}`,
  },
  custom_declined: {
    vars: ['code', 'reason', 'link'],
    text: (v) => `About your custom request ${v.code}: we cannot take this one. ${v.reason} Details: ${v.link}`,
  },
  custom_alert: {
    vars: ['code', 'title', 'who'],
    text: (v) => `New custom request ${v.code} from ${v.who}: ${v.title}. Send a price in the console.`,
  },
  abandoned_nudge: {
    vars: ['name', 'product', 'code', 'link'],
    text: (v) => `Hi ${v.name}, your ${v.product} order ${v.code} is saved and waiting. Finish paying whenever you are ready and we start straight away: ${v.link}`,
  },
  referral_reward: {
    vars: ['friend', 'amount', 'code', 'link'],
    text: (v) => `${v.friend} just got their first Brandit order, thanks to you. Here is ${v.amount} off your next order: ${v.code}. Use it here: ${v.link}`,
  },
  rider_nearby: {
    vars: ['rider', 'delivery_code', 'link'],
    text: (v) => `Your rider ${v.rider} is about 10 minutes away. Have your delivery code ready: ${v.delivery_code}. Track it here: ${v.link}`,
  },
  studio_ready: {
    vars: ['link'],
    text: (v) => `Your Brandit Studio designs are ready. Have a look and pick your favourite: ${v.link}`,
  },
  studio_checked: {
    vars: ['link'],
    text: (v) => `A Brandit designer checked your design and it is ready to print. Order it here: ${v.link}`,
  },
  studio_changes: {
    vars: ['note', 'link'],
    text: (v) => `A Brandit designer has a note on your design: ${v.note} Open it here to fix it, at no extra charge: ${v.link}`,
  },
  studio_refund: {
    vars: ['amount', 'reason'],
    text: (v) => `We refunded ${v.amount} for your Brandit Studio design. ${v.reason} It can take a few days to show in your account.`,
  },
  studio_feedback: {
    vars: ['name', 'verdict', 'link'],
    text: (v) => `${v.name} looked at your design and said: ${v.verdict}. See what they wrote here: ${v.link}`,
  },
  studio_credit: {
    vars: ['amount', 'days', 'link'],
    text: (v) => `Your approved design comes with ${v.amount} off your print order. Order within ${v.days} days here: ${v.link}`,
  },
  studio_review_alert: {
    vars: ['title', 'link'],
    text: (v) => `A Studio design is waiting for a check: ${v.title}. Open the queue: ${v.link}`,
  },
};

/** Messages meant for our own team. They stay in English whatever a customer chose. */
export const STAFF_TEMPLATES: TemplateKey[] = ['at_risk', 'custom_alert', 'studio_review_alert'];

// Nigerian Pidgin, for customers who switch it on. Same variables as the English text, so the same WhatsApp
// template layout works for both. Have a Pidgin speaker on your team read these before you turn the switch on.
const PIDGIN: Record<TemplateKey, (v: Vars) => string> = {
  paid: (v) => `Payment don land. We don start work on order ${v.code}. Next, person go check your file. ${v.arrive_line} Track am here: ${v.link}`,
  file_checked: (v) => `${v.staff_name} don check your file. E ready to print.`,
  file_problem: (v) => `Small wahala dey your file: ${v.issue} Upload new one here: ${v.link}. Your delivery clock don pause until then.`,
  proof_ready: (v) => `Your proof don ready. Come look am and approve am here: ${v.link}. We no go print anything until you approve.`,
  printing: (v) => `Order ${v.code} dey print now. ${v.arrive_line}`,
  out_for_delivery: (v) => `Your finished job don comot, e dey road. Track your rider here: ${v.link}. Give the rider this code: ${v.delivery_code}`,
  ready_for_pickup: (v) => `Your finished job don ready for pickup. Show this code when you wan collect am: ${v.delivery_code}. Details: ${v.link}`,
  delivered: (v) => `Delivered! If anything no correct, tell us here: ${v.link}`,
  review_request: (v) => `How we do for order ${v.code}? E go take you two taps: ${v.link}`,
  late_refund: (v) => `Sorry o, order ${v.code} don late and na our fault. We don refund your delivery fee. Track am here: ${v.link}`,
  late_notice: (v) => `Sorry o, order ${v.code} don late and na our fault. We dey on am. Track am here: ${v.link}`,
  new_time: (v) => `Your arrival time don change. ${v.arrive_line} Track am here: ${v.link}`,
  reprint_started: (v) => `We dey reprint order ${v.code} free of charge. Track am here: ${v.link}`,
  refund_issued: (v) => `We don refund ${v.amount} for order ${v.code}. E fit take few days before e show for your account.`,
  claim_rejected: (v) => `About order ${v.code}: we check your report and we no fit reprint or refund this time. ${v.reason} Reply here if you wan talk am.`,
  at_risk: (v) => TEMPLATES.at_risk.text(v),
  custom_received: (v) => `We don get your custom request ${v.code}. Person go send you price within ${v.hours} hours. You fit check am anytime: ${v.link}`,
  custom_quote_ready: (v) => `Your price for ${v.code} don ready: ${v.price}. We go deliver ${v.days} working days after you approve your proof. See the details and accept am here: ${v.link}`,
  custom_declined: (v) => `About your custom request ${v.code}: we no fit do this one. ${v.reason} Details: ${v.link}`,
  custom_alert: (v) => TEMPLATES.custom_alert.text(v),
  abandoned_nudge: (v) => `Hi ${v.name}, your ${v.product} order ${v.code} still dey wait for you. Finish the payment when you ready and we go start work sharp-sharp: ${v.link}`,
  referral_reward: (v) => `${v.friend} just do their first Brandit order because of you. Na ${v.amount} off your next order be this: ${v.code}. Use am here: ${v.link}`,
  rider_nearby: (v) => `Your rider ${v.rider} don near, about 10 minutes. Make your delivery code ready: ${v.delivery_code}. Track am here: ${v.link}`,
  studio_ready: (v) => `Your Brandit Studio designs don ready. Come look am and pick the one you like: ${v.link}`,
  studio_checked: (v) => `Brandit designer don check your design and e ready to print. Order am here: ${v.link}`,
  studio_changes: (v) => `Brandit designer get small note for your design: ${v.note} Open am here make you fix am, no extra charge: ${v.link}`,
  studio_refund: (v) => `We don refund ${v.amount} for your Brandit Studio design. ${v.reason} E fit take few days before e show for your account.`,
  studio_feedback: (v) => `${v.name} look your design and talk say: ${v.verdict}. See wetin dem write here: ${v.link}`,
  studio_credit: (v) => `Your approved design come with ${v.amount} off your print order. Order am within ${v.days} days here: ${v.link}`,
  studio_review_alert: (v) => TEMPLATES.studio_review_alert.text(v),
};

export const pidgin = (key: TemplateKey, vars: Vars) => PIDGIN[key](vars);

export const render = (key: TemplateKey, vars: Vars, lang: Lang = 'en') =>
  lang === 'pcm' && !STAFF_TEMPLATES.includes(key) ? PIDGIN[key](vars) : TEMPLATES[key].text(vars);
