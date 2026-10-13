import { RULES, CATEGORY_MESSAGE, CATEGORY_LABEL, type Category } from '../../content/studio-policy';

/*
 * Content rules for Studio. Three layers:
 *  1. Built-in rules (content/studio-policy.ts) and the team's own extra words, applied to every brief before anything is made.
 *  2. An optional second opinion from OpenAI's free moderation endpoint (text and pictures), when OPENAI_API_KEY is set.
 *  3. People: the console review queue, and the print desk, who can refuse any job.
 * A "block" stops the request with a message that says what to do instead. A "review" lets it through and puts it
 * in front of a person.
 */

export type Finding = { cat: Category; verdict: 'block' | 'review'; matched: string };
export type Verdict = { verdict: 'allow' | 'review' | 'block'; category?: Category; message?: string; findings: Finding[]; matched?: string };

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

/** Lower case, no accents, and the usual disguises undone (p0rn, n@ked). Yoruba and Igbo marks never hide a match. */
export function normalise(text: string): string {
  const base = String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Only undo digit and symbol disguises inside a word that also has letters, so phone numbers and years are left alone.
  const undone = base.replace(/[a-z0-9@$!]+/g, (w) => (/[a-z]/.test(w) && /[a-z][0-9@$!]|[0-9@$!][a-z]/.test(w) ? w.replace(/[0-9@$!]/g, (c) => LEET[c] ?? c) : w));
  return undone.replace(/[_*~^`|\\]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "p o r n" and "p.o.r.n": the same word with gaps. Only used for the worst words. */
const squeeze = (n: string) => n.replace(/[^a-z]/g, '');
const SQUEEZED = ['porn', 'nsfw', 'naked', 'nudity', 'hentai', 'genocide', 'massacre'];

export function scanText(text: string, o: { scope: 'words' | 'look'; idStrict?: boolean; extra?: string }): Finding[] {
  const n = normalise(text);
  if (!n) return [];
  const out: Finding[] = [];
  for (const r of RULES) {
    if (r.lookOnly && o.scope === 'words' && !(r.idStrict && o.idStrict)) continue;
    const m = r.re.exec(n);
    if (m) out.push({ cat: r.cat, verdict: r.verdict, matched: m[0].slice(0, 40) });
  }
  const sq = squeeze(n);
  for (const t of SQUEEZED) {
    if (sq.includes(t) && !n.includes(t) && sq.length < 400) out.push({ cat: t === 'genocide' || t === 'massacre' ? 'violence' : 'sexual', verdict: 'block', matched: t });
  }
  for (const line of (o.extra ?? '').split('\n')) {
    const term = normalise(line);
    if (term.length >= 3 && new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(n)) out.push({ cat: 'custom', verdict: 'block', matched: term });
  }
  return out;
}

const worst = (f: Finding[]): Verdict => {
  const block = f.find((x) => x.verdict === 'block');
  if (block) return { verdict: 'block', category: block.cat, message: CATEGORY_MESSAGE[block.cat], findings: f, matched: block.matched };
  const rev = f.find((x) => x.verdict === 'review');
  if (rev) return { verdict: 'review', category: rev.cat, findings: f, matched: rev.matched };
  return { verdict: 'allow', findings: [] };
};

export type BriefForCheck = { productSlug: string; occasion: string; lines: { id?: string; text: string }[]; look?: string; extra?: string };

/** Check what the customer typed before anything is made. */
export function moderateBrief(b: BriefForCheck): Verdict {
  const id = b.productSlug === 'id-cards';
  if (id && b.occasion !== 'staff_id') {
    return { verdict: 'block', category: 'official_document', message: 'ID cards in Studio are for your own company\'s staff cards. Choose "Staff ID card" and use your own company name and logo.', findings: [] };
  }
  const all: Finding[] = [];
  for (const l of b.lines) all.push(...scanText(l.text, { scope: 'words', idStrict: id, extra: b.extra }));
  if (b.look) all.push(...scanText(b.look, { scope: 'look', idStrict: id, extra: b.extra }));
  return worst(all);
}

export const describeFinding = (f: Pick<Finding, 'cat' | 'matched'>) => `${CATEGORY_LABEL[f.cat]}: "${f.matched}"`;

// ---------- Second opinion from OpenAI (free to call) ----------
export const remoteModerationOn = () => !!process.env.OPENAI_API_KEY;

type Remote = { flagged: boolean; categories: string[]; unavailable?: boolean };

async function openaiModerate(input: unknown): Promise<Remote> {
  if (!remoteModerationOn()) return { flagged: false, categories: [], unavailable: true };
  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { flagged: false, categories: [], unavailable: true };
    const j: any = await res.json();
    const r = j?.results?.[0];
    if (!r) return { flagged: false, categories: [], unavailable: true };
    const cats = Object.entries(r.categories ?? {}).filter(([, v]) => v === true).map(([k]) => k);
    return { flagged: !!r.flagged, categories: cats };
  } catch {
    return { flagged: false, categories: [], unavailable: true };
  }
}

const REMOTE_MAP: Record<string, Category> = {
  sexual: 'sexual', 'sexual/minors': 'sexual', violence: 'violence', 'violence/graphic': 'violence', hate: 'hate', 'hate/threatening': 'hate',
  harassment: 'hate', 'harassment/threatening': 'hate', 'illicit': 'illegal', 'illicit/violent': 'illegal', 'self-harm': 'violence', 'self-harm/intent': 'violence', 'self-harm/instructions': 'violence',
};

function fromRemote(r: Remote): Verdict {
  if (!r.flagged) return { verdict: 'allow', findings: [] };
  const cat = REMOTE_MAP[r.categories[0]] ?? 'custom';
  return { verdict: 'block', category: cat, message: CATEGORY_MESSAGE[cat], findings: [{ cat, verdict: 'block', matched: r.categories.join(', ') }], matched: r.categories.join(', ') };
}

export async function moderateTextRemote(text: string): Promise<Verdict & { unavailable?: boolean }> {
  const r = await openaiModerate(text.slice(0, 4000));
  return { ...fromRemote(r), unavailable: r.unavailable };
}

/** Look at a picture, an upload or a result. Without a key the answer is "unchecked", and the review queue is the safeguard. */
export async function moderateImage(buf: Buffer, mime = 'image/jpeg'): Promise<Verdict & { unchecked?: boolean }> {
  const r = await openaiModerate([{ type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } }]);
  if (r.unavailable) return { verdict: 'allow', findings: [], unchecked: true };
  return fromRemote(r);
}
