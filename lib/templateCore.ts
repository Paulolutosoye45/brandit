/*
 * Ready-made templates, the parts that need no database: the questions we ask, how a preview is drawn,
 * and how the answers become a design brief a designer can start from.
 */
export type FieldKind = 'text' | 'long' | 'date';
export type TemplateField = { key: string; label: string; hint: string; kind: FieldKind; required: boolean };

export const LAYOUTS = ['invite', 'programme', 'flyer', 'menu', 'banner', 'poster', 'shirt'] as const;
export type Layout = (typeof LAYOUTS)[number];
export const LAYOUT_LABEL: Record<Layout, string> = { invite: 'Invitation', programme: 'Programme', flyer: 'Flyer', menu: 'Menu', banner: 'Banner', poster: 'Poster', shirt: 'T-shirt' };

export const PALETTES = {
  ink: { label: 'Navy and gold', bg: '#0B1F33', fg: '#FFFFFF', accent: '#FFC400', soft: '#16344F' },
  royal: { label: 'Royal blue', bg: '#1B3A8A', fg: '#FFFFFF', accent: '#F4C542', soft: '#2A4CA5' },
  emerald: { label: 'Emerald', bg: '#0F5B46', fg: '#FFFFFF', accent: '#F2D16B', soft: '#17745A' },
  burgundy: { label: 'Burgundy', bg: '#6B1A2B', fg: '#FFF6E8', accent: '#E8C27A', soft: '#852339' },
  cream: { label: 'Cream and gold', bg: '#FBF4E4', fg: '#2A1E14', accent: '#B8862F', soft: '#F1E6CC' },
  white: { label: 'Clean white', bg: '#FFFFFF', fg: '#0B1F33', accent: '#FFC400', soft: '#EEF1F4' },
  coral: { label: 'Coral', bg: '#E8553E', fg: '#FFFFFF', accent: '#FFE08A', soft: '#F07A66' },
  black: { label: 'Black and gold', bg: '#141414', fg: '#FFFFFF', accent: '#FFC400', soft: '#262626' },
} as const;
export type PaletteKey = keyof typeof PALETTES;
export const PALETTE_KEYS = Object.keys(PALETTES) as PaletteKey[];
export const isPalette = (v: unknown): v is PaletteKey => typeof v === 'string' && v in PALETTES;
export const isLayout = (v: unknown): v is Layout => typeof v === 'string' && (LAYOUTS as readonly string[]).includes(v);

export type Look = { layout: Layout; palette: PaletteKey; lines: string[] };

export const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const keyOf = (label: string) => slugify(label).replace(/-/g, '_').slice(0, 30) || 'field';

/**
 * One question per line: "Church name* | Full name as it should appear | text"
 * A star after the label makes it required. The last part is text (default), long or date.
 */
export function parseFieldLines(text: string): TemplateField[] {
  const out: TemplateField[] = [];
  const used = new Set<string>();
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [l, h, k] = line.split('|').map((x) => x.trim());
    const required = /\*\s*$/.test(l);
    const label = l.replace(/\*\s*$/, '').trim().slice(0, 60);
    if (!label) continue;
    let key = keyOf(label);
    for (let i = 2; used.has(key); i++) key = `${keyOf(label).slice(0, 26)}_${i}`;
    used.add(key);
    const kind: FieldKind = k === 'long' || k === 'date' ? k : 'text';
    out.push({ key, label, hint: (h ?? '').slice(0, 120), kind, required });
    if (out.length >= 12) break;
  }
  return out;
}

export const fieldsToLines = (fields: TemplateField[]) =>
  fields.map((f) => `${f.label}${f.required ? '*' : ''} | ${f.hint}${f.kind !== 'text' ? ` | ${f.kind}` : ''}`).join('\n');

export type Answers = Record<string, string>;
const MAX = { text: 120, long: 900, date: 40 } as const;

/** Keep only the answers to questions we asked, trimmed, and say which required ones are missing. */
export function cleanAnswers(fields: TemplateField[], raw: unknown): { answers: Answers; missing: TemplateField | null } {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const answers: Answers = {};
  let missing: TemplateField | null = null;
  for (const f of fields) {
    const v = typeof src[f.key] === 'string' ? (src[f.key] as string).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, MAX[f.kind]) : '';
    if (f.kind === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v) && v.length > 40) continue;
    if (v) answers[f.key] = v;
    else if (f.required && !missing) missing = f;
  }
  return { answers, missing };
}

const niceDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const [y, m, d] = v.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NG', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

/** The words a designer reads: every question with the answer, in the order we asked. */
export function composeWording(fields: TemplateField[], answers: Answers): string {
  return fields
    .filter((f) => answers[f.key])
    .map((f) => (f.kind === 'long' ? `${f.label}:\n${answers[f.key]}` : `${f.label}: ${f.kind === 'date' ? niceDate(answers[f.key]) : answers[f.key]}`))
    .join('\n');
}
