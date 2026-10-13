import type { Q } from './db';
import { parseFieldLines, type Look } from './templateCore';

/*
 * Starting templates and seasonal pages. They are written from facts the shop already states (products, sizes, quantities),
 * and promise nothing the app cannot keep. After the first start the team owns them: edit them in the console.
 */
type SeedTemplate = {
  slug: string; title: string; category: string; blurb: string; includes: string;
  product: string; quantity: number; sizeKey?: string; config?: Record<string, string>; widthFt?: number; heightFt?: number;
  purpose: string; fields: string; look: Look;
};

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    slug: 'church-programme', title: 'Church programme', category: 'Church',
    blurb: 'An order of service or programme for a thanksgiving, harvest, crossover or special service.',
    includes: 'A5 programme sheet, 100 copies',
    product: 'flyers', quantity: 100, purpose: 'Church programme',
    fields: 'Church name* | As it should appear at the top\nService or event title* | For example: Annual Thanksgiving Service\nDate and time* | For example: Sunday 14 March, 9am\nVenue* | Street address or hall\nOrder of service | One item per line, with times if you have them | long\nTheme or scripture | Optional\nContact number | For enquiries',
    look: { layout: 'programme', palette: 'royal', lines: ['Thanksgiving Service', 'Sunday, 9:00 am', 'Opening prayer', 'Praise and worship', 'Sermon', 'Offering', 'Benediction'] },
  },
  {
    slug: 'funeral-programme', title: 'Funeral programme', category: 'Memorial',
    blurb: 'A respectful order of service for a funeral, burial or memorial. Send a photo and we place it for you.',
    includes: 'A5 programme sheet, 100 copies',
    product: 'flyers', quantity: 100, purpose: 'Funeral programme',
    fields: 'Full name of the person* | As it should be printed\nDates | Birth and passing, for example 1950 to 2026\nService details* | Date, time and place | long\nOrder of service | One item per line | long\nTribute or a short verse | Optional | long\nFamily line | For example: Mourned by his wife, children and grandchildren',
    look: { layout: 'programme', palette: 'cream', lines: ['A Celebration of Life', 'Mr. A. B. Johnson', '1950 to 2026', 'Order of service', 'Tributes', 'Interment'] },
  },
  {
    slug: 'wedding-invite', title: 'Wedding invitation', category: 'Weddings',
    blurb: 'A clean invitation card with your names, date, venue and RSVP.',
    includes: 'A5 invitation, 100 copies',
    product: 'flyers', quantity: 100, purpose: 'Wedding invitation',
    fields: 'Names of the couple* | For example: Ada and Tunde\nWedding date and time* | For example: Saturday 5 December, 11am\nVenue* | Name and address\nReception | If it is somewhere else\nDress code or colours | Optional\nRSVP name and number* | Who guests should call or message\nAnything else to include | A line from you both, a hashtag, a scripture | long',
    look: { layout: 'invite', palette: 'burgundy', lines: ['Together with their families', 'Ada and Tunde', 'invite you to their wedding', 'Saturday, 5 December', 'RSVP 0803 000 0000'] },
  },
  {
    slug: 'school-flyer', title: 'School notice flyer', category: 'School',
    blurb: 'An admission, resumption or open-day notice for parents.',
    includes: 'A5 flyer, 100 copies',
    product: 'flyers', quantity: 100, purpose: 'School notice flyer',
    fields: 'School name* | As it should appear\nWhat is the notice about?* | For example: Admission open for the new term\nImportant dates* | Dates parents must know | long\nClasses or ages | Optional\nAddress* | Where the school is\nContact numbers* | One per line | long\nSchool colours | Optional',
    look: { layout: 'flyer', palette: 'emerald', lines: ['ADMISSION OPEN', 'New term, all classes', 'Call 0803 000 0000', 'Lagos'] },
  },
  {
    slug: 'restaurant-menu', title: 'Menu card', category: 'Food and drink',
    blurb: 'A handy A5 menu card for your restaurant, bukka, bakery or small chops business.',
    includes: 'A5 menu card, 100 copies',
    product: 'flyers', quantity: 100, purpose: 'Menu card',
    fields: 'Business name* | As it should appear\nMenu items and prices* | One item per line, like: Jollof rice and chicken, 3500 | long\nOpening days and hours | Optional\nAddress | Optional\nOrder line* | Phone or WhatsApp number\nInstagram or website | Optional',
    look: { layout: 'menu', palette: 'cream', lines: ['The Menu', 'Jollof rice 3,500', 'Fried rice 3,500', 'Peppered chicken 2,000', 'Zobo 800'] },
  },
  {
    slug: 'event-banner', title: 'Event banner', category: 'Events',
    blurb: 'A 6 × 3 ft flex banner for a launch, crusade, party or shop. Change the size on the next page if you need to.',
    includes: 'Flex banner, 6 × 3 ft, eyelets included',
    product: 'flex-banners', quantity: 1, widthFt: 6, heightFt: 3, purpose: 'Event banner',
    fields: 'Event or business name* | The big words on the banner\nTagline or date | For example: 14 March, 10am\nVenue or address | Optional\nContact number* | Phone or WhatsApp\nPicture or logo to include | Describe it, or attach it on this page | long\nColours you like | Optional',
    look: { layout: 'banner', palette: 'ink', lines: ['GRAND OPENING', 'Saturday 14 March', 'Come and celebrate with us', '0803 000 0000'] },
  },
  {
    slug: 'birthday-poster', title: 'Birthday or party poster', category: 'Events',
    blurb: 'An A3 poster for a birthday, graduation, surprise party or reunion.',
    includes: 'A3 poster, 10 copies',
    product: 'posters', quantity: 10, purpose: 'Birthday or party poster',
    fields: 'Whose celebration?* | Name and age or milestone\nDate and time* | When it happens\nVenue* | Where it happens\nDress code or theme | Optional\nRSVP or contact* | Name and number\nPhoto | Describe it, or attach it on this page | long',
    look: { layout: 'poster', palette: 'coral', lines: ['HAPPY 40TH', 'Chinedu', 'Saturday 20 March', 'Lekki, Lagos'] },
  },
  {
    slug: 'event-tshirts', title: 'Event T-shirts', category: 'Events',
    blurb: 'Matching shirts for family, a wedding party, a church group or a team. Colours are confirmed on your proof.',
    includes: 'Cotton T-shirts, front print, 10 pieces',
    product: 'branded-t-shirts', quantity: 10, sizeKey: 'each', config: { colour: 'white' }, purpose: 'Event T-shirts',
    fields: 'Event or group name* | What goes on the shirt\nWords or slogan | Optional\nShirt colour you want | White, black or navy. We confirm stock on your proof\nSizes you need | For example: 4 medium, 4 large, 2 XL | long\nLogo or picture | Describe it, or attach it on this page | long',
    look: { layout: 'shirt', palette: 'white', lines: ['TEAM', 'ADEBAYO', 'FAMILY REUNION', '2026'] },
  },
  {
    slug: 'shop-opening-flyer', title: 'Shop opening or promo flyer', category: 'Business',
    blurb: 'A bold A5 flyer to announce an opening, a sale or a new service.',
    includes: 'A5 flyer, 100 copies',
    product: 'flyers', quantity: 100, purpose: 'Shop opening or promo flyer',
    fields: 'Business name* | As it should appear\nHeadline* | For example: Now open in Surulere\nOffer or what you sell | Prices, discounts, services | long\nAddress* | Where to find you\nContact numbers* | Phone or WhatsApp\nOpening hours | Optional\nInstagram or website | Optional',
    look: { layout: 'flyer', palette: 'black', lines: ['NOW OPEN', 'Visit us this week', 'Special opening prices', '0803 000 0000'] },
  },
  {
    slug: 'roll-up-banner-event', title: 'Roll-up banner', category: 'Events',
    blurb: 'A stand-alone banner for your table, stage, reception or shop front.',
    includes: 'Roll-up banner, 85 × 200 cm, with stand',
    product: 'roll-up-banners', quantity: 1, sizeKey: 'each', purpose: 'Roll-up banner',
    fields: 'Business or event name* | The big words at the top\nWhat do you offer or announce?* | Short lines | long\nContact details* | Phone, WhatsApp, website\nLogo and pictures | Describe them, or attach them on this page | long\nColours you like | Optional',
    look: { layout: 'poster', palette: 'royal', lines: ['YOUR BRAND', 'What we do', 'Call 0803 000 0000', 'brand.ng'] },
  },
];

/** Add the starting templates to a database that has products and no templates yet. */
export async function seedTemplates(q: Pick<Q, 'query'>) {
  const have = await q.query<{ n: number }>('select count(*)::int as n from templates');
  if (have[0].n > 0) return;
  let sort = 0;
  for (const t of SEED_TEMPLATES) {
    const p = await q.query<{ id: string }>('select id from products where slug = $1 and not system', [t.product]);
    if (!p[0]) continue;
    await q.query(
      `insert into templates (slug, title, category, blurb, includes, product_id, quantity, size_key, config, width_ft, height_ft, fields, look, purpose, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) on conflict (slug) do nothing`,
      [t.slug, t.title, t.category, t.blurb, t.includes, p[0].id, t.quantity, t.sizeKey ?? null, JSON.stringify(t.config ?? {}), t.widthFt ?? null, t.heightFt ?? null, JSON.stringify(parseFieldLines(t.fields)), JSON.stringify(t.look), t.purpose, sort++],
    );
  }
}

type SeedCampaign = {
  slug: string; title: string; headline: string; intro: string; theme: string; startsOn: string; endsOn: string; note: string;
  products: string[]; templates: string[];
};

export const SEED_CAMPAIGNS: SeedCampaign[] = [
  {
    slug: 'wedding-season', title: 'Wedding season', theme: 'burgundy', startsOn: '2026-09-15', endsOn: '2026-12-31',
    headline: 'Print for the big day, all in one place.',
    intro: 'Invitations, order-of-service programmes, banners for the venue and matching T-shirts for the family. Fill in a template and we design it, or send your own design.',
    note: 'Tell us the date you need it by when you order. We say yes or no to your deadline before you pay.',
    products: ['flyers', 'flex-banners', 'roll-up-banners', 'branded-t-shirts'], templates: ['wedding-invite', 'event-banner', 'event-tshirts'],
  },
  {
    slug: 'december-events', title: 'December events', theme: 'ink', startsOn: '2026-10-20', endsOn: '2026-12-24',
    headline: 'December is busy. Print early.',
    intro: 'Carol services, church programmes, end-of-year parties, family reunions and shop promotions. Banners, posters, flyers and T-shirts, with your price and delivery time shown before you pay.',
    note: 'We do not print or deliver on public holidays, and the deadline check already knows them. Order early and pick the date you need it by.',
    products: ['posters', 'flex-banners', 'roll-up-banners', 'flyers', 'branded-t-shirts'], templates: ['church-programme', 'event-banner', 'birthday-poster', 'event-tshirts'],
  },
  {
    slug: 'back-to-school', title: 'Back to school', theme: 'emerald', startsOn: '2027-07-20', endsOn: '2027-09-30',
    headline: 'Ready for the new term.',
    intro: 'ID cards for pupils and staff, notice flyers for parents, posters for the noticeboard and branded T-shirts for house teams.',
    note: 'ID card details are deleted from our systems after the retention period in our Privacy Policy.',
    products: ['id-cards', 'flyers', 'posters', 'branded-t-shirts', 'stickers'], templates: ['school-flyer'],
  },
];

export async function seedCampaigns(q: Pick<Q, 'query'>) {
  const have = await q.query<{ n: number }>('select count(*)::int as n from campaigns');
  if (have[0].n > 0) return;
  let sort = 0;
  for (const c of SEED_CAMPAIGNS) {
    await q.query(
      `insert into campaigns (slug, title, headline, intro, theme, starts_on, ends_on, last_order_note, product_slugs, template_slugs, show_on_home, active, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true,$11) on conflict (slug) do nothing`,
      [c.slug, c.title, c.headline, c.intro, c.theme, c.startsOn, c.endsOn, c.note, c.products, c.templates, sort++],
    );
  }
}

/** Migration 006 on a database that already has products, and seed for a brand new one. */
export async function seedGrowthContent(q: Pick<Q, 'query'>) {
  await seedTemplates(q);
  await seedCampaigns(q);
}
