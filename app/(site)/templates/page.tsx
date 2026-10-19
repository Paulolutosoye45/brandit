import Link from 'next/link';
import type { Metadata } from 'next';
import { categoriesOfTemplates, listTemplates, templatePrice } from '@/lib/templates';
import { TemplateCard } from '@/components/TemplateCard';
import { PageHead } from '@/components/Bits';
import { getLang } from '@/lib/lang';
import { translator } from '@/content/pidgin-ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Ready-made templates', description: 'Church programmes, wedding invitations, school flyers, menus and banners. Answer a few questions and we design it for you.' };

export default async function Templates(props: { searchParams: Promise<{ c?: string }> }) {
  const sp = await props.searchParams;
  const t = translator(await getLang());
  const all = await listTemplates();
  const cats = categoriesOfTemplates(all);
  const cat = cats.includes(sp.c ?? '') ? sp.c! : '';
  const shown = cat ? all.filter((t) => t.category === cat) : all;
  const prices = await Promise.all(shown.map((t) => templatePrice(t)));
  return (
    <>
      <PageHead title={t('Start from a template')} sub={t('Pick a style, answer a few questions, and we design it for you. You see the price before you pay and approve a proof before anything prints.')} />
      <div className="mx-auto max-w-[1160px] px-5 pb-16">
        {cats.length > 1 && (
          <nav aria-label={t('Template categories')} className="mb-6 flex flex-wrap gap-2">
            <Link href="/templates" className="choice" aria-current={!cat ? 'page' : undefined} data-on={!cat}>{t('All')}</Link>
            {cats.map((c) => <Link key={c} href={`/templates?c=${encodeURIComponent(c)}`} className="choice" aria-current={cat === c ? 'page' : undefined} data-on={cat === c}>{c}</Link>)}
          </nav>
        )}
        {shown.length === 0 ? (
          <div className="card grid justify-items-center gap-3 p-10 text-center"><p className="font-display text-[24px] font-extrabold">{t('No templates here yet.')}</p><Link href="/custom-order" className="btn-primary">{t('Ask for a custom price')}</Link></div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {shown.map((tpl, i) => <TemplateCard key={tpl.id} t={tpl} totalKobo={prices[i] ? prices[i]!.printKobo + prices[i]!.designKobo : null} />)}
          </div>
        )}
        <p className="mt-8 text-[15px] text-muted">{t('Do not see yours?')} <Link href="/custom-order" className="link">{t('Describe it and get a price')}</Link> {t('or')} <Link href="/products" className="link">{t('choose a product and upload your own design')}</Link>.</p>
      </div>
    </>
  );
}
