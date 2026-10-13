import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHead } from '@/components/Bits';
import { Logo } from '@/components/Logo';
import { SITE } from '@/lib/site';
import { listProducts } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'About Brandit', description: 'Brandit is a design and print service in Lagos, built so that ordering print is easy on a phone and you always know your price and your delivery time.' };

export default async function About() {
  const names = (await listProducts()).map((p) => p.name.toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? 'print';
  return (
    <>
      <PageHead title="About Brandit" sub="Design and print for Lagos, made to be easy." />
      <div className="mx-auto grid max-w-[760px] gap-10 px-5 pb-12 text-[18px] leading-relaxed">
        <Logo variant="stacked" className="h-auto w-[220px]" />
        <section className="grid gap-3">
          <h2 className="text-[28px]">Why we exist</h2>
          <p>Getting something printed in Lagos should not mean travelling to three places, calling five times, and hoping it arrives when someone said it would. You should be able to do it from your phone, see what it costs, know exactly when it will arrive, and have someone you can reach if anything goes wrong.</p>
          <p>That is Brandit. We design and print, and we bring it to you.</p>
        </section>
        <section className="grid gap-3">
          <h2 className="text-[28px]">What we believe</h2>
          <ul className="grid list-disc gap-3 pl-5">
            <li><span className="font-bold">You should know before you pay.</span> The price and the arrival time are on the screen before you pay a kobo.</li>
            <li><span className="font-bold">A person should check your work.</span> Every file is looked at before it prints, and you approve a proof first.</li>
            <li><span className="font-bold">If we get it wrong, we fix it.</span> That is <Link className="link" href="/help#promise">the Brandit Promise</Link>: reprint or refund, and the delivery fee back if a 24-hour order is late.</li>
            <li><span className="font-bold">Plain words.</span> No jargon, no hidden steps, no chasing.</li>
          </ul>
        </section>
        <section className="grid gap-3">
          <h2 className="text-[28px]">Who is behind it</h2>
          <p>Brandit is run by {SITE.owner}, based in Lagos. When you message us, a person answers, {SITE.hours}.</p>
        </section>
        <section className="grid gap-3">
          <h2 className="text-[28px]">What we print</h2>
          <p>We print {list}, and more. If you need something that is not on the list, <Link className="link" href="/custom-order">ask for a custom price</Link>.</p>
        </section>
        <div className="flex flex-wrap gap-3">
          <Link href="/products" className="btn-primary">Start your order</Link>
          <Link href="/contact" className="btn-secondary">Talk to us</Link>
        </div>
      </div>
    </>
  );
}
