import Link from 'next/link';
import type { ReactNode } from 'react';

/*
 * A small, safe way to show words the team wrote. It understands headings (## and ###), paragraphs, bullet lists (- ),
 * numbered lists (1. ), bold (**x**), italics (*x*), links ([words](/page or https://…)) and a line (---).
 * It never writes raw HTML, so nothing typed into the console can run as code on the site.
 */
const SAFE_LINK = /^(\/(?!\/)[\w\-./?=&%#]*|https:\/\/[^\s<>"']+|mailto:[^\s<>"']+|tel:[+\d]+)$/;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${n++}`;
    if (m[1] !== undefined) {
      const href = m[2];
      if (SAFE_LINK.test(href)) out.push(href.startsWith('/') ? <Link key={key} href={href}>{m[1]}</Link> : <a key={key} href={href}>{m[1]}</a>);
      else out.push(m[1]);
    } else if (m[3] !== undefined) out.push(<strong key={key}>{m[3]}</strong>);
    else out.push(<em key={key}>{m[4]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export type Heading = { id: string; title: string };
export const headingsOf = (md: string): Heading[] =>
  md.split('\n').filter((l) => /^##\s+/.test(l)).map((l, i) => ({ id: `s${i + 1}`, title: l.replace(/^##\s+/, '').replace(/[*_]/g, '').trim() }));

export function MiniMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0, k = 0, h2 = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m: RegExpExecArray | null;
    if ((m = /^##\s+(.*)$/.exec(line))) { h2++; blocks.push(<h2 key={k++} id={`s${h2}`} className="scroll-mt-24">{inline(m[1], `h${k}`)}</h2>); i++; continue; }
    if ((m = /^###\s+(.*)$/.exec(line))) { blocks.push(<h3 key={k++} className="text-[20px] font-bold">{inline(m[1], `h${k}`)}</h3>); i++; continue; }
    if (/^---+\s*$/.test(line)) { blocks.push(<hr key={k++} className="border-line" />); i++; continue; }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^[-*]\s+/, ''));
      blocks.push(<ul key={k++}>{items.map((t, j) => <li key={j}>{inline(t, `u${k}-${j}`)}</li>)}</ul>); continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\d+[.)]\s+/, ''));
      blocks.push(<ol key={k++} className="grid list-decimal gap-2 pl-5">{items.map((t, j) => <li key={j}>{inline(t, `o${k}-${j}`)}</li>)}</ol>); continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|[-*]\s|\d+[.)]\s|---+\s*$)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++}>{inline(para.join(' '), `p${k}`)}</p>);
  }
  return <>{blocks}</>;
}
