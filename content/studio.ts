/*
 * What Brandit Studio knows about Nigerian occasions, looks and colours. Plain data, so the team can read it,
 * change a line and see the effect. Nothing here talks to a vendor.
 *
 * A "line" is one box the customer types into. The words typed in these boxes are never sent to the picture
 * maker: Brandit sets them in real fonts, so the spelling on screen is the spelling on the print.
 */

export type LineRole = 'headline' | 'sub' | 'date' | 'place' | 'contact' | 'extra';
export type LineDef = { id: string; label: string; hint: string; role: LineRole; required?: boolean; example: string; max?: number };

export type OccasionId =
  | 'owambe' | 'wedding' | 'church' | 'naming' | 'memorial' | 'birthday' | 'school' | 'shop' | 'party' | 'business' | 'group' | 'staff_id' | 'other';

export type Occasion = {
  id: OccasionId;
  label: string;
  blurb: string;
  /** What the picture maker is told this is for. English, plain. */
  art: string;
  /** Dignified occasions get calm palettes and no playful motifs. */
  tone: 'festive' | 'dignified' | 'playful' | 'business';
  lines: LineDef[];
  palette: string; // id in PALETTES
  styles: string[]; // ids in STYLES that suit it best
  products: string[]; // product slugs it is usually for
};

export const OCCASIONS: Occasion[] = [
  {
    id: 'owambe', label: 'Owambe or party', blurb: 'Aso-ebi, family and friends, a day to remember.', tone: 'festive',
    art: 'a lively Nigerian owambe celebration with matching family fabric (aso-ebi), joyful and colourful',
    palette: 'royal-gold', styles: ['ankara', 'gold-white', 'aso-oke'], products: ['flyers', 'posters', 'tees-and-totes', 'flex-banners'],
    lines: [
      { id: 'who', label: 'Whose celebration?', hint: 'Names exactly as they should print', role: 'headline', required: true, example: 'Chief & Mrs Adéwálé Ọláńrewájú', max: 70 },
      { id: 'what', label: 'What is the occasion?', hint: 'For example: 60th birthday and thanksgiving', role: 'sub', example: '60th Birthday & Thanksgiving', max: 60 },
      { id: 'date', label: 'Date and time', hint: 'Saturday 14 March 2026, 11am prompt', role: 'date', example: 'Saturday 14 March 2026, 11am', max: 60 },
      { id: 'where', label: 'Venue', hint: 'Name and area', role: 'place', example: 'Eko Hotel & Suites, Victoria Island', max: 80 },
      { id: 'colours', label: 'Aso-ebi colours (optional)', hint: 'For example: Royal blue and gold', role: 'extra', example: 'Aso-ebi: Royal blue & gold', max: 60 },
      { id: 'rsvp', label: 'RSVP phone (optional)', hint: 'Number guests should call', role: 'contact', example: 'RSVP: 0803 123 4567', max: 40 },
    ],
  },
  {
    id: 'wedding', label: 'Wedding or engagement', blurb: 'Traditional or white wedding, save-the-date, programme.', tone: 'festive',
    art: 'an elegant Nigerian wedding celebration, refined and joyful, with fine fabric textures',
    palette: 'wine-cream', styles: ['gold-white', 'floral', 'aso-oke'], products: ['flyers', 'posters', 'picture-frames', 'tees-and-totes', 'stickers'],
    lines: [
      { id: 'couple', label: 'The couple', hint: 'Both names as they should print', role: 'headline', required: true, example: 'Ṣọlá & Chidi', max: 50 },
      { id: 'what', label: 'What is the event?', hint: 'Traditional wedding, white wedding, engagement', role: 'sub', example: 'Traditional Wedding', max: 50 },
      { id: 'date', label: 'Date and time', hint: '', role: 'date', example: 'Saturday 6 June 2026, 10am', max: 60 },
      { id: 'where', label: 'Venue', hint: '', role: 'place', example: 'The Civic Centre, Victoria Island, Lagos', max: 80 },
      { id: 'hash', label: 'Hashtag or dress code (optional)', hint: '', role: 'extra', example: '#ṢọláWedsChidi', max: 40 },
    ],
  },
  {
    id: 'church', label: 'Church or mosque programme', blurb: 'Thanksgiving, convention, harvest, Ramadan, naming.', tone: 'dignified',
    art: 'a calm, dignified Nigerian faith gathering, soft light, restrained and respectful, no religious figures',
    palette: 'navy-silver', styles: ['church-serene', 'gold-white', 'modern-minimal'], products: ['flyers', 'posters', 'flex-banners', 'roll-up-banners', 'tees-and-totes'],
    lines: [
      { id: 'title', label: 'Programme title', hint: 'For example: Annual Thanksgiving Service', role: 'headline', required: true, example: 'Annual Thanksgiving Service', max: 60 },
      { id: 'theme', label: 'Theme or verse (optional)', hint: 'Type it exactly', role: 'sub', example: 'Theme: Great is Thy Faithfulness', max: 90 },
      { id: 'date', label: 'Date and time', hint: '', role: 'date', example: 'Sunday 22 November, 9am', max: 60 },
      { id: 'where', label: 'Venue', hint: '', role: 'place', example: 'Grace Assembly, Ikeja', max: 80 },
      { id: 'host', label: 'Host or guest minister (optional)', hint: '', role: 'extra', example: 'Pastor Ifeanyi Okafor', max: 60 },
    ],
  },
  {
    id: 'naming', label: 'Naming ceremony', blurb: 'Welcome a new baby, with the names and the day.', tone: 'festive',
    art: 'a warm Nigerian baby naming ceremony, gentle and joyful, soft colours, no photographs of babies',
    palette: 'lemon-white', styles: ['floral', 'modern-minimal', 'ankara'], products: ['flyers', 'posters', 'picture-frames', 'stickers', 'tees-and-totes'],
    lines: [
      { id: 'name', label: 'Baby\'s name(s)', hint: 'All the names, exactly as given', role: 'headline', required: true, example: 'Ọ̀rẹ́oluwa Adébáyọ̀ Chukwuemeka', max: 70 },
      { id: 'parents', label: 'Parents (optional)', hint: '', role: 'sub', example: 'Son of Mr & Mrs Adébáyọ̀', max: 70 },
      { id: 'date', label: 'Date and time', hint: '', role: 'date', example: 'Saturday 2 May 2026, 11am', max: 60 },
      { id: 'where', label: 'Venue', hint: '', role: 'place', example: 'The family house, Surulere', max: 80 },
    ],
  },
  {
    id: 'memorial', label: 'Memorial or burial', blurb: 'A dignified tribute and the details of the service.', tone: 'dignified',
    art: 'a dignified, restrained tribute background, soft and calm, no people, no bright or playful motifs, no religious figures',
    palette: 'black-gold', styles: ['church-serene', 'modern-minimal', 'gold-white'], products: ['posters', 'flyers', 'flex-banners', 'picture-frames', 'roll-up-banners'],
    lines: [
      { id: 'name', label: 'Full name', hint: 'With titles, exactly as it should print', role: 'headline', required: true, example: 'Chief Ọlábísí Adéwálé', max: 70 },
      { id: 'dates', label: 'Sunrise and sunset (optional)', hint: 'Dates of birth and passing', role: 'sub', example: '12 March 1948 – 3 January 2026', max: 60 },
      { id: 'tribute', label: 'A line of tribute (optional)', hint: '', role: 'extra', example: 'A life well lived. Forever in our hearts.', max: 90 },
      { id: 'date', label: 'Date and time of service', hint: '', role: 'date', example: 'Friday 16 January 2026, 10am', max: 60 },
      { id: 'where', label: 'Venue', hint: '', role: 'place', example: 'St. Paul\'s Church, Ebute Metta', max: 80 },
    ],
  },
  {
    id: 'birthday', label: 'Birthday', blurb: 'For any age. A shirt, a flyer, a poster, a sticker.', tone: 'playful',
    art: 'a joyful birthday celebration, bright and fun, confetti and balloons, festive',
    palette: 'coral-teal', styles: ['bold-pop', 'ankara', 'floral'], products: ['tees-and-totes', 'posters', 'flyers', 'stickers', 'picture-frames'],
    lines: [
      { id: 'name', label: 'Celebrant\'s name', hint: '', role: 'headline', required: true, example: 'Kẹ́mi turns 30', max: 50 },
      { id: 'tagline', label: 'A line (optional)', hint: 'For example: Thirty, flirty and thriving', role: 'sub', example: 'Thirty, flirty and thriving', max: 70 },
      { id: 'date', label: 'Date and time (optional)', hint: '', role: 'date', example: 'Saturday 18 April, 7pm', max: 60 },
      { id: 'where', label: 'Venue (optional)', hint: '', role: 'place', example: 'The Cube, Lekki', max: 80 },
      { id: 'rsvp', label: 'RSVP phone (optional)', hint: '', role: 'contact', example: '0803 123 4567', max: 40 },
    ],
  },
  {
    id: 'school', label: 'School or graduation', blurb: 'Class sets, graduation, school events, club shirts.', tone: 'business',
    art: 'a proud Nigerian school or graduation theme, clean and uplifting, books, laurels and bright school colours',
    palette: 'navy-gold', styles: ['modern-minimal', 'bold-pop', 'gold-white'], products: ['tees-and-totes', 'posters', 'flyers', 'flex-banners', 'stickers'],
    lines: [
      { id: 'name', label: 'School, class or group name', hint: '', role: 'headline', required: true, example: 'Federal Government College, Class of 2026', max: 70 },
      { id: 'motto', label: 'Motto or line (optional)', hint: '', role: 'sub', example: 'Unity and Faith, Peace and Progress', max: 70 },
      { id: 'date', label: 'Date (optional)', hint: '', role: 'date', example: 'Graduation Day: 25 July 2026', max: 60 },
      { id: 'where', label: 'Place (optional)', hint: '', role: 'place', example: 'Lagos', max: 80 },
    ],
  },
  {
    id: 'shop', label: 'Shop opening or promo', blurb: 'A banner, flyer, sticker or card for your business.', tone: 'business',
    art: 'a bright, trustworthy small-business launch or sales promotion, modern Lagos retail feel',
    palette: 'lemon-black', styles: ['bold-pop', 'modern-minimal', 'lagos-skyline'], products: ['flex-banners', 'flyers', 'stickers', 'roll-up-banners', 'posters', 'business-cards'],
    lines: [
      { id: 'name', label: 'Business name', hint: '', role: 'headline', required: true, example: 'Bisi\'s Fabrics & Beads', max: 50 },
      { id: 'offer', label: 'The message or offer', hint: 'For example: Grand opening, 20% off all week', role: 'sub', example: 'Grand Opening: 20% off all week', max: 80 },
      { id: 'date', label: 'Date (optional)', hint: '', role: 'date', example: 'From Monday 5 October', max: 60 },
      { id: 'where', label: 'Address', hint: 'Street and landmark', role: 'place', example: '14 Awolowo Road, Ikoyi (beside Total filling station)', max: 90 },
      { id: 'phone', label: 'Phone or WhatsApp', hint: '', role: 'contact', example: 'WhatsApp: 0803 123 4567', max: 40 },
    ],
  },
  {
    id: 'party', label: 'Detty December or event night', blurb: 'Parties, concerts, brunches, club nights.', tone: 'playful',
    art: 'an energetic Lagos nightlife and festive-season event, bold colour, rhythm and movement',
    palette: 'purple-gold', styles: ['bold-pop', 'neon-night', 'lagos-skyline'], products: ['flyers', 'posters', 'flex-banners', 'tees-and-totes', 'stickers'],
    lines: [
      { id: 'name', label: 'Event name', hint: '', role: 'headline', required: true, example: 'Detty December Brunch', max: 50 },
      { id: 'tag', label: 'Tagline (optional)', hint: '', role: 'sub', example: 'Music. Food. Good vibes.', max: 70 },
      { id: 'date', label: 'Date and time', hint: '', role: 'date', example: 'Sat 27 Dec, 2pm till late', max: 60 },
      { id: 'where', label: 'Venue', hint: '', role: 'place', example: 'Landmark Beach, Oniru', max: 80 },
      { id: 'entry', label: 'Entry or tickets (optional)', hint: '', role: 'extra', example: 'Gate: ₦10,000 · VIP: ₦25,000', max: 60 },
      { id: 'phone', label: 'Contact (optional)', hint: '', role: 'contact', example: '0803 123 4567', max: 40 },
    ],
  },
  {
    id: 'business', label: 'Brand, card or stationery', blurb: 'Business cards, letterheads, labels with a clean look.', tone: 'business',
    art: 'a refined, modern brand background with subtle pattern, professional and Nigerian in feel',
    palette: 'navy-gold', styles: ['modern-minimal', 'gold-white', 'dark-luxe'], products: ['business-cards', 'stickers', 'flyers'],
    lines: [
      { id: 'name', label: 'Name or business', hint: '', role: 'headline', required: true, example: 'Adéyínká Ṣódípẹ̀', max: 50 },
      { id: 'title', label: 'Job title or tagline', hint: '', role: 'sub', example: 'Chartered Accountant', max: 60 },
      { id: 'phone', label: 'Phone', hint: '', role: 'contact', example: '0803 123 4567', max: 40 },
      { id: 'email', label: 'Email or website', hint: '', role: 'contact', example: 'hello@adeyinka.ng', max: 60 },
      { id: 'where', label: 'Address (optional)', hint: '', role: 'place', example: '14 Awolowo Road, Ikoyi, Lagos', max: 90 },
    ],
  },
  {
    id: 'group', label: 'Group shirt or reunion', blurb: 'Family reunion, team, church group, class.', tone: 'playful',
    art: 'a proud group celebration, bold and unified, strong graphic shapes that print well on a shirt',
    palette: 'emerald-gold', styles: ['bold-pop', 'ankara', 'modern-minimal'], products: ['tees-and-totes', 'stickers', 'posters', 'flex-banners'],
    lines: [
      { id: 'name', label: 'Group name', hint: '', role: 'headline', required: true, example: 'Ojo Family Reunion', max: 50 },
      { id: 'year', label: 'Year or event', hint: '', role: 'sub', example: 'Lagos 2026', max: 40 },
      { id: 'line', label: 'A line (optional)', hint: '', role: 'extra', example: 'One blood, one family', max: 60 },
    ],
  },
  {
    id: 'staff_id', label: 'Staff ID card', blurb: 'For your own staff only. Your logo, name and role.', tone: 'business',
    art: 'a very simple, clean abstract card background in two flat brand colours, no pattern that competes with a photo',
    palette: 'navy-gold', styles: ['modern-minimal'], products: ['id-cards'],
    lines: [
      { id: 'company', label: 'Company name', hint: 'Your own business', role: 'headline', required: true, example: 'Eko Fresh Foods Ltd', max: 50 },
      { id: 'name', label: 'Staff name', hint: '', role: 'sub', required: true, example: 'Ngozi Okonkwo', max: 50 },
      { id: 'role', label: 'Role', hint: '', role: 'extra', required: true, example: 'Sales Executive', max: 40 },
      { id: 'no', label: 'Staff number (optional)', hint: '', role: 'date', example: 'Staff No: EF-0142', max: 30 },
      { id: 'phone', label: 'Company phone (optional)', hint: '', role: 'contact', example: '0803 123 4567', max: 40 },
    ],
  },
  {
    id: 'other', label: 'Something else', blurb: 'Tell us what it is and type your words.', tone: 'festive',
    art: 'a tasteful, well-balanced design for the occasion described',
    palette: 'royal-gold', styles: ['modern-minimal', 'bold-pop', 'gold-white'], products: [],
    lines: [
      { id: 'headline', label: 'Main words', hint: 'The biggest line', role: 'headline', required: true, example: 'Your main line here', max: 70 },
      { id: 'sub', label: 'Second line (optional)', hint: '', role: 'sub', example: '', max: 90 },
      { id: 'date', label: 'Date (optional)', hint: '', role: 'date', example: '', max: 60 },
      { id: 'where', label: 'Place (optional)', hint: '', role: 'place', example: '', max: 80 },
      { id: 'phone', label: 'Phone or contact (optional)', hint: '', role: 'contact', example: '', max: 50 },
    ],
  },
];

export const occasionById = (id: string): Occasion => OCCASIONS.find((o) => o.id === id) ?? OCCASIONS[OCCASIONS.length - 1];

export type Palette = { id: string; label: string; bg: string; accent: string; ink: string; soft: string };
/** bg: main colour. accent: the second colour. ink: the colour of words on a light panel. soft: a pale tone for panels. */
export const PALETTES: Palette[] = [
  { id: 'royal-gold', label: 'Royal blue and gold', bg: '#12307A', accent: '#E8B931', ink: '#0B1F33', soft: '#FFF6DA' },
  { id: 'emerald-gold', label: 'Emerald and gold', bg: '#0B6B4B', accent: '#E8B931', ink: '#073B2A', soft: '#F2F7E6' },
  { id: 'wine-cream', label: 'Wine and cream', bg: '#6B1230', accent: '#F3E3C3', ink: '#3A0A19', soft: '#FFF8EC' },
  { id: 'coral-teal', label: 'Coral and teal', bg: '#F26B5B', accent: '#12847A', ink: '#1F2933', soft: '#FFF1EC' },
  { id: 'purple-gold', label: 'Purple and gold', bg: '#4B1D7D', accent: '#F2B705', ink: '#22093F', soft: '#F6EEFF' },
  { id: 'black-gold', label: 'Black and gold', bg: '#141414', accent: '#D4AF37', ink: '#0B0B0B', soft: '#F6F1E3' },
  { id: 'navy-silver', label: 'Navy and silver', bg: '#14263F', accent: '#C5CCD6', ink: '#0B1220', soft: '#EEF2F7' },
  { id: 'navy-gold', label: 'Navy and gold', bg: '#0B1F33', accent: '#E8B931', ink: '#0B1F33', soft: '#FFF6DA' },
  { id: 'lemon-white', label: 'Lemon and white', bg: '#FFF3B0', accent: '#2E7D6B', ink: '#2B2B2B', soft: '#FFFFFF' },
  { id: 'lemon-black', label: 'Yellow and black', bg: '#FFD21F', accent: '#111111', ink: '#111111', soft: '#FFF8D1' },
  { id: 'peach-navy', label: 'Peach and navy', bg: '#FFC9A8', accent: '#1B2A4A', ink: '#1B2A4A', soft: '#FFF2E8' },
];
export const paletteById = (id: string): Palette => PALETTES.find((p) => p.id === id) ?? PALETTES[0];

export type StylePack = { id: string; label: string; art: string; /** art direction in plain English for the picture maker */ muted?: boolean };
export const STYLES: StylePack[] = [
  { id: 'ankara', label: 'Ankara print', art: 'bold Ankara wax-print geometric patterns, repeating circles, leaves and fans, flat vivid colour' },
  { id: 'adire', label: 'Adire indigo', art: 'adire indigo resist-dyed patterns, hand-drawn white motifs on deep blue, textured cloth feel' },
  { id: 'aso-oke', label: 'Aso-oke weave', art: 'handwoven aso-oke stripes and woven texture with fine gold thread accents' },
  { id: 'gold-white', label: 'Gold and white', art: 'elegant white and soft gold, delicate ornament, airy, refined' },
  { id: 'modern-minimal', label: 'Clean and modern', art: 'clean modern minimal composition, generous calm space, a few simple shapes' },
  { id: 'bold-pop', label: 'Bold and bright', art: 'bold flat shapes, high-contrast bright colours, energetic and graphic' },
  { id: 'floral', label: 'Floral', art: 'soft painted tropical flowers and leaves, gentle and graceful' },
  { id: 'lagos-skyline', label: 'Lagos city', art: 'stylised Lagos city silhouette, bridge and skyline, yellow danfo buses as small flat shapes, sunset sky' },
  { id: 'church-serene', label: 'Calm and serene', art: 'soft diffused light, quiet gradient, gentle rays, serene and respectful' },
  { id: 'dark-luxe', label: 'Dark and luxe', art: 'deep black background with fine gold lines and subtle texture, premium feel' },
  { id: 'neon-night', label: 'Night party', art: 'night party glow, bright magenta and electric blue light streaks', muted: true },
  { id: 'earthy', label: 'Earthy and handmade', art: 'earthy handmade mud-cloth style patterns in terracotta, cream and black' },
];
export const styleById = (id: string) => STYLES.find((s) => s.id === id);

/** Different looks for the first few concepts, so the customer gets real choices and not four near-copies. */
export const VARIATIONS = [
  'a strong border of pattern with a calm open centre',
  'colour sweeping diagonally across the page with scattered small motifs',
  'a full-bleed pattern fading to a soft, calm area',
  'a large simple central motif on a quiet background',
  'pattern concentrated at the top and bottom edges, calm open space between',
  'layered soft shapes and gradients, no hard pattern',
];

/**
 * Words people type in English, Pidgin or Yoruba, turned into plain English art direction.
 * Anything not listed is passed on unchanged, because the picture makers cope with plain sentences.
 */
export const LEXICON: [RegExp, string][] = [
  [/\bowanbe\b|\bowambe\b/gi, 'a lively Nigerian celebration party'],
  [/\baso[\s-]?ebi\b|\basoebi\b/gi, 'matching family fabric in coordinated colours'],
  [/\baso[\s-]?oke\b/gi, 'handwoven aso-oke cloth'],
  [/\bgele\b/gi, 'a head-tie'],
  [/\bagbada\b/gi, 'a flowing agbada robe'],
  [/\bbuba\b/gi, 'a buba top'],
  [/\bankara\b/gi, 'Ankara wax print'],
  [/\badire\b/gi, 'adire indigo cloth'],
  [/\bdetty\s*december\b/gi, 'a festive-season Lagos celebration'],
  [/\bdanfo\b/gi, 'a yellow Lagos danfo bus'],
  [/\bmake e (fine|sweet|shine)\b/gi, 'make it beautiful and polished'],
  [/\bfine[\s-]fine\b/gi, 'very beautiful'],
  [/\bsharp[\s-]sharp\b/gi, 'quickly'],
  [/\bna the\b/gi, 'it is the'],
  [/\bwey dey\b/gi, 'that is'],
  [/\bcolour(s)?\s+wey\b/gi, 'colours that'],
  [/\bno get\b/gi, 'without'],
  [/\bplenty\b/gi, 'a lot of'],
  [/\bdey shine\b/gi, 'shining'],
];

/** The five things the customer is told in plain words about how Studio treats their words and faces. */
export const STUDIO_PROMISES = [
  'You see two free sketches before you pay anything.',
  'Names, dates and phone numbers are set by Brandit in real fonts, exactly as you typed them.',
  'Your photos are never redrawn. Faces stay your own pixels.',
  'We check the print is sharp at your size before you can order it.',
  'If a paid design fails, your money goes back by itself.',
];

/*
 * Choices shown on the design page. Kept here (plain data, no files or libraries) so the browser can import them.
 * The ids must match the fonts in lib/studio/fonts.ts; a unit test checks it.
 */
export const FONT_CHOICES: { id: string; label: string; blurb: string }[] = [
  { id: 'montserrat', label: 'Bold modern', blurb: 'Clear and confident. Good for almost anything.' },
  { id: 'anton', label: 'Tall and heavy', blurb: 'Big, loud headlines for parties, shops and shirts.' },
  { id: 'garamond', label: 'Classic serif', blurb: 'Elegant. Weddings, memorials and church programmes.' },
  { id: 'script', label: 'Script', blurb: 'Flowing handwriting for names. Check capital letters carefully.' },
  { id: 'inter', label: 'Plain and neutral', blurb: 'Simple and easy to read.' },
  { id: 'noto', label: 'Universal', blurb: 'The safety font. Every letter and symbol Studio can print.' },
];
export const SHAPE_CHOICES: { id: string; label: string }[] = [
  { id: 'rounded', label: 'Rounded corners' },
  { id: 'rect', label: 'Square corners' },
  { id: 'circle', label: 'Circle' },
  { id: 'oval', label: 'Oval' },
  { id: 'cutout', label: 'Person cut out' },
];
export const THEME_CHOICES: { id: string; label: string }[] = [
  { id: 'auto', label: 'Let Studio choose' },
  { id: 'light', label: 'Light words' },
  { id: 'dark', label: 'Dark words' },
];
