import type { Metadata } from 'next';
import Link from 'next/link';
import { listProducts } from '@/lib/catalog';
import { getCustomer } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { contactPhone } from '@/lib/identity';
import { formatLocal } from '@/lib/phoneFormat';
import { PageHead } from '@/components/Bits';
import { CustomForm } from './CustomForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Custom order: tell us what you need',
  description: 'Need something that is not on the price list? Tell us what you need. A person sends you a price, and you pay only if you say yes.',
};

const STEPS = [
  ['1', 'Tell us', 'What you need, how many, and a photo if you have one.'],
  ['2', 'We send a price', 'A person looks at it and sends a price and a delivery time.'],
  ['3', 'You decide', 'Pay only if you are happy. No payment before that.'],
];

export default async function CustomOrder(props: { searchParams: Promise<{ product?: string }> }) {
  const sp = await props.searchParams;
  const [products, me, s] = await Promise.all([listProducts(), getCustomer(), getSettings()]);
  const local = (p: string | null | undefined) => (p ? formatLocal(p) : '');
  return (
    <>
      <PageHead title="Need something different?" sub="Tell us what you need. We send you a price, and you pay only if you say yes." />
      <div className="mx-auto max-w-[1160px] px-5 pb-12 grid gap-8 lg:grid-cols-[1fr_340px] items-start">
        <CustomForm
          products={products.filter((p) => p.allow_custom).map((p) => ({ slug: p.slug, name: p.name }))}
          initialProduct={sp.product ?? ''}
          defaults={{ name: me?.name ?? '', phone: local(me ? contactPhone(me) : null), email: me?.email ?? '' }}
          replyHours={s.custom_reply_hours}
          whatsapp={process.env.NEXT_PUBLIC_WHATSAPP ?? null}
        />
        <aside className="grid gap-4 lg:sticky lg:top-[84px]" aria-label="How a custom order works">
          <ol className="card p-5 grid gap-4">
            {STEPS.map(([n, t, d]) => (
              <li key={n} className="flex gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent font-display font-extrabold">{n}</span>
                <span><span className="block font-bold">{t}</span><span className="block text-[15px] text-muted">{d}</span></span>
              </li>
            ))}
          </ol>
          <div className="card p-5 grid gap-1 text-[15px]">
            <p className="font-bold">What you can ask for</p>
            <p className="text-muted">Odd sizes, special paper, a bigger quantity than our list, a mix of products, branded packaging, anything printed. If we cannot do it, we tell you straight away.</p>
          </div>
          <p className="text-[14px] text-muted">We reply within {s.custom_reply_hours} hours, Monday to Saturday. Looking for something on our list? <Link href="/products" className="link">See all products</Link>.</p>
        </aside>
      </div>
    </>
  );
}
