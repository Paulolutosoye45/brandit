import { Notice } from './Bits';
import { getBusiness } from '@/lib/business';

export type TocItem = { id: string; title: string };

/** A numbered legal section. The number is part of the heading so people can quote "section 9". */
export function LSection({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="grid scroll-mt-24 gap-3">
      <h2>{n}. {title}</h2>
      {children}
    </section>
  );
}

export async function LegalPage({ title, updated, toc, intro, children }: { title: string; updated: string; toc?: TocItem[]; intro?: React.ReactNode; children: React.ReactNode }) {
  const reviewed = (await getBusiness()).legalReviewed;
  return (
    <article className="mx-auto grid max-w-[760px] gap-6 px-5 py-10">
      <div className="grid gap-2">
        <h1 className="text-[40px] leading-[1.05] sm:text-[48px]">{title}</h1>
        <p className="text-muted">Last updated {updated}</p>
      </div>
      {intro && <div className="text-[19px] leading-snug">{intro}</div>}
      {!reviewed && (
        <Notice tone="warn"><span className="font-bold">Draft for legal review.</span> This is plain-language starting text. Have a Nigerian lawyer review and adapt it before Brandit takes public orders.</Notice>
      )}
      {toc && toc.length > 0 && (
        <nav aria-label="On this page" className="card p-0">
          <details className="group">
            <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-bold [&::-webkit-details-marker]:hidden">
              Jump to a section ({toc.length})
              <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-paper2 text-[20px] leading-none group-open:rotate-45">+</span>
            </summary>
          <ol className="grid gap-x-6 gap-y-1 px-5 pb-4 text-[16px] sm:grid-cols-2">
            {toc.map((t, i) => (
              <li key={t.id}><a className="inline-flex min-h-[36px] items-center gap-2 underline-offset-2 hover:underline" href={`#${t.id}`}><span className="tabular text-muted">{i + 1}.</span>{t.title}</a></li>
            ))}
          </ol>
          </details>
        </nav>
      )}
      <div className="grid gap-9 text-[17px] leading-relaxed [&_h2]:text-[26px] [&_h2]:leading-tight [&_p]:max-w-[68ch] [&_ul]:grid [&_ul]:gap-2 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2">{children}</div>
    </article>
  );
}
