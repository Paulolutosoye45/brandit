import { LegalPage } from './LegalPage';
import { MiniMarkdown, headingsOf } from './MiniMarkdown';
import { getBusiness } from '@/lib/business';
import { fillPlaceholders } from '@/lib/contentPages';

/** A policy page written by the team in the console. It sits in the same frame as the built-in pages. */
export async function OwnPage({ title, updatedAt, body }: { title: string; updatedAt: string; body: string }) {
  const c = await getBusiness();
  const text = fillPlaceholders(body, c);
  const toc = headingsOf(text);
  const updated = new Date(updatedAt).toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });
  return (
    <LegalPage title={title} updated={updated} toc={toc.length > 2 ? toc : undefined}>
      <MiniMarkdown source={text} />
    </LegalPage>
  );
}
