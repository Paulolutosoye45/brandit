import { MAX_PIECES } from './options';

/*
 * Personalised batches: ID cards, name tees, certificates, invitations, anything where each piece carries a different name.
 * The customer pastes a list (or uploads a spreadsheet); each row is a name, an optional note (role, size, a line of text)
 * and an optional number of copies. The line's quantity becomes the number of pieces on the list, so the price follows it.
 * The list is kept on the line and shown to the press on the job, and can be downloaded as a spreadsheet.
 */
export type NameRow = { name: string; note: string; qty: number };
export const MAX_NAMES = 500;
const MAX_COPIES = 99;
const NAME_LEN = 60;
const NOTE_LEN = 80;

export type ParsedList = { ok: true; rows: NameRow[]; total: number; warnings: string[] } | { ok: false; error: string };

const clean = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** Split one pasted line into cells. Tabs (copied from Excel) win, then semicolons, then commas. */
function cells(line: string): string[] {
  const d = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
  return line.split(d).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
}

/** Read a list from pasted text or from the rows of a spreadsheet. Never throws: problems come back in words. */
export function parseNameList(input: string | string[][]): ParsedList {
  const raw: string[][] = typeof input === 'string'
    ? input.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim()).map(cells)
    : input.map((r) => r.map((c) => String(c ?? '')));
  const warnings: string[] = [];
  const rows: NameRow[] = [];
  let first = true;
  const seen = new Map<string, number>();
  for (const r of raw) {
    if (r.every((c) => !c.trim())) continue;
    // A heading row ("Name, Role, Copies") is not a person.
    if (first && /^(names?|full ?names?|staff( names?)?|employees?|students?|recipients?)$/i.test(r[0]?.trim() ?? '')) { first = false; continue; }
    first = false;
    // Lists pasted from a document are often numbered: "1. Ada Obi".
    const name = clean((r[0] ?? '').replace(/^\s*\d{1,4}\s*[.)]\s+/, '').replace(/^["“](.*)["”]$/, '$1'), NAME_LEN);
    if (!name) continue;
    if ((r[0] ?? '').trim().length > NAME_LEN) warnings.push(`“${name}” was shortened to ${NAME_LEN} letters.`);
    let note = '';
    let qty = 1;
    const second = (r[1] ?? '').trim();
    const third = (r[2] ?? '').trim();
    if (r.length === 2 && /^\d{1,3}$/.test(second)) qty = Number(second); // "Ada Obi, 2"
    else {
      note = clean(second, NOTE_LEN);
      if (third) {
        if (/^\d{1,3}$/.test(third)) qty = Number(third);
        else warnings.push(`The number of copies for ${name} (“${third}”) is not a number, so we used 1.`);
      }
    }
    if (!(qty >= 1 && qty <= MAX_COPIES)) { warnings.push(`${name} has ${qty} copies; we used ${Math.min(Math.max(qty, 1), MAX_COPIES)}.`); qty = Math.min(Math.max(qty, 1), MAX_COPIES); }
    const key = name.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
    rows.push({ name, note, qty });
    if (rows.length > MAX_NAMES) return { ok: false, error: `A list can hold up to ${MAX_NAMES} names. Split it into two orders.` };
  }
  if (rows.length === 0) return { ok: false, error: 'We could not find any names. Put one name on each line, like “Ada Obi”, or “Ada Obi, Accounts, 2” to add a role and a number of copies.' };
  for (const [k, n] of seen) if (n > 1) warnings.push(`${rows.find((x) => x.name.toLowerCase() === k)!.name} appears ${n} times. Leave it if that is right.`);
  const total = rows.reduce((a, r) => a + r.qty, 0);
  if (total > MAX_PIECES) return { ok: false, error: `That adds up to ${total.toLocaleString('en-US')} pieces. The most we can take in one order is ${MAX_PIECES.toLocaleString('en-US')}.` };
  return { ok: true, rows, total, warnings };
}

export const totalOf = (rows: NameRow[] | null | undefined) => (rows ?? []).reduce((a, r) => a + (Number(r.qty) || 0), 0);

/** The list as text the customer can edit again. */
export function listText(rows: NameRow[] | null | undefined): string {
  return (rows ?? []).map((r) => {
    const parts = [r.name];
    if (r.note || r.qty !== 1) parts.push(r.note);
    if (r.qty !== 1) parts.push(String(r.qty));
    return parts.join(', ');
  }).join('\n');
}

/** A cell that a spreadsheet would run as a formula is neutralised. */
const cell = (v: string | number) => {
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The list as a spreadsheet file for the press. */
export function namesCsv(rows: NameRow[]): string {
  return ['No.,Name,Note,Copies', ...rows.map((r, i) => [i + 1, r.name, r.note, r.qty].map(cell).join(','))].join('\r\n') + '\r\n';
}
