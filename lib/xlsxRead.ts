import { inflateRawSync } from 'node:zlib';

/*
 * A small reader for Excel workbooks (.xlsx), so a price sheet can be uploaded exactly as saved from Excel, Numbers
 * or Google Sheets, with no "Save as CSV" step. It reads values only: text, numbers and the saved result of
 * formulas. A workbook is a zip of XML files; this reads just the few it needs and refuses anything unusually large.
 */

export class XlsxError extends Error {}

const MAX_ENTRY = 20_000_000; // bytes after unzipping
const MAX_ENTRIES = 400;
const MAX_CELLS = 400_000;

type Entry = { name: string; method: number; csize: number; usize: number; offset: number };

function entries(buf: Buffer): Entry[] {
  // The end-of-directory record is in the last 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxError('This file is not an Excel workbook.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new XlsxError('This workbook has too many parts to be a price sheet.');
  const out: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError('This workbook is damaged.');
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    out.push({ method: buf.readUInt16LE(p + 10), csize: buf.readUInt32LE(p + 20), usize: buf.readUInt32LE(p + 24), offset: buf.readUInt32LE(p + 42), name: buf.toString('utf8', p + 46, p + 46 + nameLen) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function read(buf: Buffer, e: Entry): string {
  if (e.usize > MAX_ENTRY) throw new XlsxError('This workbook is too large to be a price sheet.');
  const o = e.offset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== 0x04034b50) throw new XlsxError('This workbook is damaged.');
  const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const raw = buf.subarray(start, start + e.csize);
  let data: Buffer;
  try {
    data = e.method === 0 ? raw : e.method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_ENTRY }) : (() => { throw new XlsxError('This workbook uses a kind of compression we cannot read.'); })();
  } catch (err) {
    if (err instanceof XlsxError) throw err;
    throw new XlsxError('This workbook is damaged or too large.');
  }
  return data.toString('utf8');
}

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase() as 'amp'] ?? '';
  });

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** "AB12" -> column index 27 (zero-based). */
function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
    const clean = si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    out.push(decode([...clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')));
  }
  return out;
}

/** A number as a person would type it: no floating-point dust, no exponent. */
function plainNumber(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  const r = Math.round(n * 100) / 100;
  return Math.abs(n - r) < 1e-6 ? String(r) : String(n);
}

function sheetRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  let cells = 0;
  for (const rowXml of xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
    const rowTag = /<row\b[^>]*>/.exec(rowXml)![0];
    const r = Number(attr(rowTag, 'r')) || rows.length + 1;
    const cols: string[] = [];
    for (const m of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (++cells > MAX_CELLS) throw new XlsxError('This workbook has too many cells to be a price sheet.');
      const tag = m[1];
      const body = m[2] ?? '';
      const ci = colIndex(attr(tag, 'r') ?? 'A');
      const t = attr(tag, 't');
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (t === 'inlineStr') text = decode([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else if (v === undefined || v.trim() === '') text = ''; // a formula nobody has calculated yet has no value
      else if (t === 's') text = strings[Number(v)] ?? '';
      else if (t === 'str') text = decode(v);
      else if (t === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
      else if (t === 'e') text = '';
      else text = plainNumber(decode(v));
      while (cols.length < ci) cols.push('');
      cols[ci] = text;
    }
    while (rows.length < r - 1) rows.push([]);
    rows[r - 1] = cols;
  }
  return rows.filter((row) => row.some((c) => c.trim() !== ''));
}

/** The rows of one sheet: the one called `prefer` if there is one, else the first. */
export function readXlsx(buf: Buffer, prefer = 'Price sheet'): string[][] {
  const files = new Map(entries(buf).map((e) => [e.name.replace(/^\//, ''), e]));
  const get = (name: string) => { const e = files.get(name); return e ? read(buf, e) : null; };
  const wb = get('xl/workbook.xml');
  if (!wb) throw new XlsxError('This does not look like an Excel workbook.');
  const rels = get('xl/_rels/workbook.xml.rels') ?? '';
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'), to = attr(m[0], 'Target');
    if (id && to) target.set(id, to.startsWith('/') ? to.slice(1) : `xl/${to.replace(/^\.\//, '')}`);
  }
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: decode(attr(m[0], 'name') ?? ''), path: target.get(attr(m[0], 'r:id') ?? '') })).filter((s) => s.path);
  if (!sheets.length) throw new XlsxError('This workbook has no sheets.');
  const pick = sheets.find((s) => s.name.toLowerCase() === prefer.toLowerCase()) ?? sheets[0];
  const xml = get(pick.path!);
  if (!xml) throw new XlsxError('The sheet could not be read.');
  const ss = get('xl/sharedStrings.xml');
  return sheetRows(xml, ss ? sharedStrings(ss) : []);
}

export const looksLikeXlsx = (buf: Buffer) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
