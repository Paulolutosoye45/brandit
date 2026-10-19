import type { Settings } from './settings-defaults';
import type { Business } from './business';
import { clock12, toMinutes } from './time';
import { naira } from './money';
import { runnable, priceOf } from './studio/config';
import { query } from './db';

/*
 * The questions and answers. The built-in ones are written here, with the live numbers (cut-off time, fees, days) filled in
 * from the settings, so they are never out of date. The team can change the wording of any built-in answer, hide one, or add
 * their own, in the console (Settings, FAQ & policies). Their edits are stored in faq_items and laid over these.
 */
export type QA = { q: string; a: string; link?: [string, string] };
export type Group = { id: string; title: string; items: QA[] };
export type FaqRow = { id: string; key: string | null; group_id: string; question: string; answer: string; hidden: boolean; position: number };

/** A stable name for a built-in question, so an edit still finds it after the wording of the question is tidied. */
export const faqKey = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

export function builtInFaq(s: Settings, c: Business): Group[] {
  const t = (hhmm: string) => clock12(Math.floor(toMinutes(hhmm) / 60), toMinutes(hhmm) % 60);
  return [
    {
      id: 'ordering', title: 'Ordering and paying', items: [
        { q: 'How do I order?', a: 'Pick a product, choose how many you want and where to deliver. You see your price and your delivery time straight away. Then upload your file, or ask us to design it. Pay, approve the preview we send you, and we print and deliver.', link: ['See the products', '/products'] },
        { q: 'Do I need an account or a password?', a: 'No password. You can browse, see prices and build your order without signing in. To pay, you sign in with Google or with a six-digit code sent to your email, which takes a few seconds. That keeps all your orders in one place, so you can order the same again in two taps.' },
        { q: 'How can I pay?', a: 'By card, bank transfer or USSD, through Paystack. You pay in full before we start, because custom print cannot be resold.' },
        { q: 'Is my payment safe?', a: 'Yes. Paystack handles the payment. We never see or keep your full card number or PIN.' },
        { q: 'I paid but my order still says unpaid. What do I do?', a: `Wait a few minutes: bank transfers and USSD can be slow. If it still shows unpaid, do not pay again. Message us with your order number and the bank alert and we will check it with Paystack. We are available ${c.hours}.` },
        { q: 'Can I add Brandit to my phone like an app?', a: 'Yes. Open the site in your phone browser and choose "Add to home screen" when we offer it, or from your browser menu. There is nothing to download from an app store, and it uses very little data.' },
        ...(s.pidgin_enabled ? [{ q: 'Can I use the site in Pidgin?', a: 'Yes. Use the English / Pidgin switch at the top of the page. English is the default. Your choice is remembered on your phone, and on your account if you are signed in, and we send your WhatsApp messages in the same language.' }] : []),
        { q: 'Can I get an invoice with my company name and tax number?', a: 'Yes. Add your business name and tax number at checkout. You get a pro-forma before you pay and a VAT invoice after.' },
      ],
    },
    {
      id: 'files', title: 'Files and design', items: [
        { q: 'What file should I upload?', a: `A PDF, JPG or PNG up to ${s.max_upload_mb} MB. If you have a Word or Canva file, export it as a PDF first.`, link: ['Getting your file right', '/help#files'] },
        { q: 'What if my picture is too small or blurry?', a: `We check it the moment you upload and tell you in plain words. You can upload a better one, ask us to fix it (${naira(s.fix_fee_kobo)}), or go ahead if you accept the result.` },
        { q: 'I do not have a design. Can you make one?', a: `Yes. Choose "Design it for me", tell us what you need, and we send you a proof. The design fee is ${naira(s.design_fee_kobo)} and you see it before you pay.` },
        { q: 'Can I start from a ready-made design?', a: 'Yes. Pick a template for a church programme, wedding invitation, menu, flyer or banner, answer a few questions, and we design it for you. You see the price before you pay and approve a proof before anything prints.', link: ['See the templates', '/templates'] },
        { q: 'Can I save my logo and colours for next time?', a: 'Yes. Sign in and open Brand kit in your account. Keep your logo, colours and up to 20 files there, and use them on later orders. You can remove them at any time.', link: ['My account', '/account'] },
        { q: 'Will I see it before it prints?', a: 'Yes. You approve a proof first and we print exactly what you approved. Check spelling and phone numbers carefully.' },
        { q: 'Is my artwork private?', a: 'Yes. Only our team and delivery partners see what they need. We never use your artwork in our own advertising without asking you.' },
      ],
    },
    ...(s.studio_enabled && runnable() ? [{
      id: 'studio', title: 'Brandit Studio (AI designs)', items: [
        { q: 'What is Brandit Studio?', a: `You type your names, dates and the look you want, and Studio makes print-ready designs for you in minutes. You see ${s.studio_free_per_week} free sketches a week before you pay. A Standard design is ${naira(priceOf(s, 'standard'))} and Premium is ${naira(priceOf(s, 'premium'))}.`, link: ['Open Studio', '/studio'] as [string, string] },
        { q: 'Will my names and dates be spelled right?', a: 'Yes. The picture-maker only draws the background. Brandit sets your words in real fonts exactly as you typed them. You also read them and tick a box before you approve.' },
        { q: 'Do you send my photo or my words abroad?', a: 'No. Only your short description of the look (style and colours) goes to the picture-making companies. Your names, dates, phone numbers and photos stay with Brandit.', link: ['How AI designs work', '/legal/ai-designs'] as [string, string] },
        { q: 'Will the print be sharp?', a: 'Before you can approve a design, Studio checks that it is sharp enough for the size you chose and tells you in plain words. If your own photo is too small, it offers a size that works, a design without the photo, or a Brandit designer.' },
        { q: 'What if the design fails or I do not like it?', a: 'A design that cannot be made is refunded automatically. You have rounds of changes included, and fixing a word or number is free. For anything else a Brandit designer can design it for you.', link: ['Refunds', '/legal/refunds#studio'] as [string, string] },
        { q: 'Can I make a political poster or an ID with Studio?', a: 'No. Studio does not make political campaign material or anything that looks like an official document. The ID card option is only for your own company\'s staff cards. Upload your own artwork if you have it.' },
        { q: 'Do I get money off printing it with Brandit?', a: `Yes. Order the print within ${s.studio_credit_days} days of approving the design and ${naira(s.studio_credit_standard_kobo)} (Standard) or ${naira(s.studio_credit_premium_kobo)} (Premium) comes off the print price automatically.` },
      ],
    }] : []),
    {
      id: 'delivery', title: 'Delivery and pickup', items: [
        { q: 'How fast can I get my order?', a: `Eligible jobs ordered before ${t(s.cutoff_time)} on a working day arrive the next working day by ${t(s.arrive_by)}. You only see the 24-hour option when your job qualifies, and you see the exact time before you pay.`, link: ['Delivery details', '/delivery'] },
        { q: 'Where do you deliver?', a: 'Across Lagos. Pick your area on the product page to see the fee and the arrival time. If your area is not listed, message us and we will tell you what is possible.' },
        ...(s.windows_enabled ? [{ q: 'Can I choose morning or afternoon delivery?', a: 'Yes, when you choose delivery you can pick the morning (9am to 1pm) or the afternoon (1pm to 5pm). It helps the rider plan the day. It is a preference, not a change to your arrival time or to the Brandit Promise. A 24-hour order is always delivered in the afternoon.' }] : []),
        { q: 'Can I see where my rider is?', a: 'When your order is out for delivery you may see a link to the rider\'s last known position on a map. It only shows while the order is out for delivery, and it is deleted once the order is delivered. If you do not see it, the rider\'s phone may have no signal. Your order is not late because of that.' },
        { q: 'Can I collect my order myself?', a: 'Yes, pickup is free. Choose pickup at checkout and we message you when it is ready.' },
        { q: 'What is the delivery code?', a: 'When your order is out for delivery we send you a short code. Give it to the rider once you have your parcel. It protects you from handing over a code too early.' },
        { q: 'Can I track my order?', a: 'Yes. Open the link in your messages, or go to Track an order and enter your order number.', link: ['Track an order', '/track'] },
      ],
    },
    {
      id: 'custom', title: 'Custom orders, templates and codes', items: [
        { q: 'The thing I need is not on your list. Can you still print it?', a: `Probably yes. Send a custom-order request with what you want, the size and quantity, and a picture if you have one. A person replies with a price, usually within ${s.custom_reply_hours} hours. It is free and you pay only if you accept.`, link: ['Ask for a custom price', '/custom-order'] },
        { q: 'I am planning a wedding or an event. Can I order everything at once?', a: 'Yes. Use Plan my event. Tell us the kind of event, the date, how many guests and which items you want. We suggest quantities, you change them, and a person sends one price for everything. You pay once and we deliver the items together, aiming for two days before your event.', link: ['Plan my event', '/plan-event'] },
        { q: 'How long is a custom quote valid?', a: `${s.custom_quote_valid_days} days. After that you can ask us to renew it.` },
        { q: 'How do I use a coupon code?', a: 'Type it in the coupon box at checkout and press Apply. One code per order. A percentage or fixed-amount code takes money off the print price; a free-delivery code removes the delivery fee. Coupons do not work on custom quotes.' },
        ...(s.referral_enabled ? [{ q: 'How do referral codes work?', a: `Sign in and open your account to find your personal code. A friend who uses it on their first order takes ${s.referral_friend_percent}% off${s.referral_friend_cap_kobo > 0 ? `, up to ${naira(s.referral_friend_cap_kobo)}` : ''}. When their order is delivered, you get a ${naira(s.referral_reward_kobo)} reward code for your next order, valid for ${s.referral_reward_days} days. You cannot use your own code.`, link: ['My account', '/account'] as [string, string] }] : []),
      ],
    },
    {
      id: 'problems', title: 'Problems, refunds and your account', items: [
        { q: 'What if my print is wrong or damaged?', a: `Report it within ${s.claim_window_hours} hours of delivery, with a photo if you can. If it does not match the file you approved, or it arrives damaged, we reprint or refund.`, link: ['Reprints and Refunds', '/legal/refunds'] },
        { q: 'What if my 24-hour order is late?', a: 'The delivery fee is refunded automatically. You do not have to ask.' },
        { q: 'Can I cancel an order?', a: 'Yes, before your proof is approved and production starts, for a full refund. Once production has started, it is made for you and cannot be cancelled.' },
        { q: 'Can I add a photo to my review?', a: 'Yes, after your order is delivered. A person at Brandit checks every photo first, and it is shown on our site only if you tick the box that allows it. We remove the location and camera details from it. You can ask us to take it down at any time.' },
        ...(s.nudge_enabled ? [{ q: 'Why did I get a message about an unpaid order?', a: 'If you fill in your details at checkout and do not pay, we send one friendly reminder with a link to carry on, between 8am and 8pm. To stop these, untick "Remind me once if I leave an order unpaid" in your account, or tell us.' }] : []),
        { q: 'How do I delete my account?', a: 'Go to your account page and choose "Delete my account". You can download your data first.', link: ['My account', '/account'] },
      ],
    },
    {
      id: 'business', title: 'For businesses', items: [
        { q: 'Do you handle bigger or repeat orders for companies?', a: 'Yes. Reorder in one tap with the approved file, get VAT invoices, and use plain-pack delivery if you print for your own clients. For large jobs, send a custom-order request for a quote.', link: ['For businesses', '/business'] },
      ],
    },
  ];
}

export type EditableItem = QA & { key: string; groupId: string; groupTitle: string; custom: boolean; hidden: boolean; edited: boolean; rowId: string | null; builtInAnswer: string | null };

/** The groups a customer sees: the built-in ones with the team's edits laid over them. */
export function applyFaqEdits(groups: Group[], rows: FaqRow[]): Group[] {
  const byKey = new Map(rows.filter((r) => r.key).map((r) => [r.key!, r]));
  const out: Group[] = groups.map((g) => ({
    ...g,
    items: g.items.flatMap((i) => {
      const r = byKey.get(faqKey(i.q));
      if (!r) return [i];
      if (r.hidden) return [];
      return [{ ...i, q: r.question.trim() || i.q, a: r.answer.trim() || i.a }];
    }),
  }));
  for (const r of rows.filter((x) => !x.key && !x.hidden).sort((a, b) => a.position - b.position)) {
    const g = out.find((x) => x.id === r.group_id) ?? out[0];
    if (g && r.question.trim() && r.answer.trim()) g.items.push({ q: r.question.trim(), a: r.answer.trim() });
  }
  return out.filter((g) => g.items.length > 0);
}

/** Every question with its state, for the editor. */
export function editableFaq(groups: Group[], rows: FaqRow[]): EditableItem[] {
  const byKey = new Map(rows.filter((r) => r.key).map((r) => [r.key!, r]));
  const items: EditableItem[] = [];
  for (const g of groups) {
    for (const i of g.items) {
      const r = byKey.get(faqKey(i.q));
      items.push({ ...i, q: r?.question.trim() || i.q, a: r?.answer.trim() || i.a, key: faqKey(i.q), groupId: g.id, groupTitle: g.title, custom: false, hidden: !!r?.hidden, edited: !!r && !r.hidden && (!!r.answer.trim() || !!r.question.trim()), rowId: r?.id ?? null, builtInAnswer: i.a });
    }
  }
  for (const r of rows.filter((x) => !x.key).sort((a, b) => a.position - b.position)) {
    const g = groups.find((x) => x.id === r.group_id) ?? groups[0];
    items.push({ q: r.question, a: r.answer, key: r.id, groupId: g?.id ?? r.group_id, groupTitle: g?.title ?? '', custom: true, hidden: r.hidden, edited: false, rowId: r.id, builtInAnswer: null });
  }
  return items;
}

export const faqRows = () => query<FaqRow>('select id, key, group_id, question, answer, hidden, position from faq_items order by position, updated_at');
