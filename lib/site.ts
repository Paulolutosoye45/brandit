/*
 * Facts about the business that pages quote. Anything we cannot know (phone, email, street address) comes from the
 * environment and is simply left out when it is not set. We never invent contact details.
 */
export const SITE = {
  name: 'Brandit',
  owner: 'Cerebre Media Africa',
  hours: 'Monday to Saturday, 8am to 6pm',
  replyWithin: '15 minutes',
};

export function contact() {
  const wa = (process.env.NEXT_PUBLIC_WHATSAPP ?? '').replace(/\D/g, '');
  return {
    whatsapp: wa || null,
    whatsappLink: (text?: string) => (wa ? `https://wa.me/${wa}${text ? `?text=${encodeURIComponent(text)}` : ''}` : null),
    email: (process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? '').trim() || null,
    address: (process.env.NEXT_PUBLIC_BUSINESS_ADDRESS ?? '').trim() || null,
  };
}

/** Set LEGAL_REVIEWED=yes once a Nigerian lawyer has reviewed the legal pages. Until then they carry a draft notice. */
export function legalReviewed(): boolean {
  return ['yes', 'true', '1'].includes((process.env.LEGAL_REVIEWED ?? '').toLowerCase());
}
