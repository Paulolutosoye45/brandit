import type { Q } from './db';

/**
 * Words for the products Brandit launches with. They are written only from facts already in the catalogue
 * (sizes, paper, colours), so nothing here promises more than the product page does.
 * New databases get them when the products are created; older ones get them once, in migration 004.
 * After that the team owns them: edit them in the console under Products.
 */
export const PRODUCT_CONTENT: Record<string, { category: string; description: string; highlights: string[] }> = {
  'business-cards': {
    category: 'Cards and stationery',
    description: 'Thick 300gsm cards, printed on both sides, the kind people keep.\n\nChoose matte or gloss, pick how many you need, and see your price and your delivery time before you pay. Send your file and a person checks it, or let us design the card for you.',
    highlights: ['300gsm card, printed on both sides', 'Matte or gloss', 'Standard size, 3.5 × 2 in', 'A person checks your file, and you approve a preview before we print'],
  },
  flyers: {
    category: 'Marketing prints',
    description: 'A5 flyers on 150gsm paper, printed on one side. Good for launches, promotions and handing out on the street.\n\nUpload your file and we check it in seconds, or tell us what you need and we design it.',
    highlights: ['A5 size (5.8 × 8.3 in), single-sided', '150gsm paper', 'Your file is checked before it prints'],
  },
  posters: {
    category: 'Marketing prints',
    description: 'A3 posters on 150gsm paper, for shop windows, events, notice boards and walls.\n\nYou do not need a big print run. Small orders are welcome.',
    highlights: ['A3 size (11.7 × 16.5 in)', '150gsm paper', 'Small runs welcome'],
  },
  'roll-up-banners': {
    category: 'Banners and signs',
    description: 'A roll-up banner stands on its own and packs away when you are done. It is a good fit for events, exhibitions, shop fronts and reception areas.\n\nThe print is 85 × 200 cm, on a stand with a big, steady base.',
    highlights: ['85 × 200 cm print', 'Big base for a steady stand', 'Rolls up for carrying'],
  },
  'flex-banners': {
    category: 'Banners and signs',
    description: 'Flex banners in any size, priced by the square foot, so you pay only for the size you need. Corner eyelets are included, so it is ready to hang.\n\nPick a common size or type your own width and height, and the price updates as you go.',
    highlights: ['Any size, priced per square foot', 'Corner eyelets included', 'Pick a common size or type your own'],
  },
  stickers: {
    category: 'Marketing prints',
    description: 'Round vinyl stickers, 3.5 inches across, for packaging, bags, boxes, cups and anywhere your brand should show up.',
    highlights: ['Round, 3.5 inch', 'Vinyl'],
  },
  'tees-and-totes': {
    category: 'Tees and Totes',
    description: 'T-shirts and tote bags with your design printed on them. Good for events, staff, teams, shops and giveaways.\n\nPick a tee or a tote at the start, then the style, colour and how many of each size. Small orders are heat-transferred; from 50 pieces we screen print, which costs less each. We confirm the colours we have in stock on your proof, before anything prints.',
    highlights: ['T-shirts and tote bags', 'Heat transfer, or screen print from 50', 'Choose how many of each size'],
  },
  'id-cards': {
    category: 'IDs and events',
    description: 'PVC ID cards in the standard landscape card size, for staff, students, members and visitors.\n\nSend your design and details, and a person checks them before printing. Files that hold people\'s details are deleted after a set time.',
    highlights: ['PVC card, landscape', 'Standard card size, 3.37 × 2.13 in', 'Staff details are deleted after a set time'],
  },
  'picture-frames': {
    category: 'Frames and gifts',
    description: 'Your photo, printed and framed, with a matte finish. Choose a size and a frame colour.\n\nA photo straight from your phone works for most sizes. When you upload it, we tell you which size will look sharpest.',
    highlights: ['Printed and framed, matte finish', 'Black, white or natural wood frame', 'We tell you which size looks sharpest for your photo'],
  },
};

/** Migration 004: fill in the launch products' words once. */
export async function backfillCatalogContent(q: Q) {
  for (const [slug, c] of Object.entries(PRODUCT_CONTENT)) {
    await q.query("update products set description = $2, highlights = $3, category = $4 where slug = $1 and description = '' and category = ''", [slug, c.description, c.highlights, c.category]);
  }
}
