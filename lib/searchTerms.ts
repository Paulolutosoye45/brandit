/*
 * Search that understands how people ask. Nobody types "tier-priced stationery": they type "church programme", "flex", "name tag".
 * Each product slug lists the words people use for it. Pure, so the home page search and the products page share it.
 */
const WORDS: Record<string, string> = {
  'business-cards': 'business card visiting card name card calling card networking contact',
  flyers: 'flyer leaflet handbill handout programme program brochure invitation menu announcement church wedding funeral school birthday party event',
  posters: 'poster wall sign advert event notice church school party',
  'roll-up-banners': 'roll up banner pull up stand display exhibition booth',
  'flex-banners': 'flex banner billboard signage outdoor backdrop church wedding funeral birthday party event school',
  stickers: 'sticker label seal packaging logo sticker',
  'tees-and-totes': 'tee t shirt tshirt shirt tote bag uniform merch polo hoodie',
  'id-cards': 'id card badge name tag staff card student card lanyard identity pvc event pass',
  'picture-frames': 'frame photo frame picture gift wall art portrait',
  'sample-pack': 'sample try paper finish',
};

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Every word that should find this product. */
export function haystack(p: { slug: string; name: string; blurb?: string; category?: string; description?: string }): string {
  return norm(`${p.name} ${p.blurb ?? ''} ${p.category ?? ''} ${p.description ?? ''} ${WORDS[p.slug] ?? ''}`);
}

/** Every typed word must appear somewhere (so "church banner" finds flex banners), tolerating a plural s. */
export function matches(hay: string, query: string): boolean {
  const words = norm(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => hay.includes(w) || (w.endsWith('s') && w.length > 3 && hay.includes(w.slice(0, -1))));
}
