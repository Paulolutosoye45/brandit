import Link from 'next/link';
import type { Metadata } from 'next';
import { getCustomer } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { accessFor, allowanceFor, naira, priceOf, runnable } from '@/lib/studio/config';
import { listProjects } from '@/lib/studio/projects';
import { OCCASIONS, STUDIO_PROMISES } from '@/content/studio';
import { POLICY_SUMMARY } from '@/content/studio-policy';
import { Check, Notice, PageHead } from '@/components/Bits';
import { BuyPack } from '@/components/studio/BuyPack';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Brandit Studio',
  description: 'Tell us about your event or business and get print-ready designs made for you, with your names and dates spelled exactly right. Two free sketches before you pay.',
};

const PAID: Record<string, string> = { pack3: 'Your three designs are ready to use. They never expire.' };

export default async function StudioHome(props: { searchParams: Promise<{ paid?: string }> }) {
  const sp = await props.searchParams;
  const [c, s] = await Promise.all([getCustomer(), getSettings()]);
  const open = s.studio_enabled && runnable();
  const access = open ? await accessFor(s, c as any) : { ok: false as const, reason: 'off' as const, message: 'Brandit Studio is not open yet.' };
  const mine = c ? await listProjects(c.id).catch(() => []) : [];
  const std = allowanceFor('standard', s), prem = allowanceFor('premium', s);
  const price = (k: Parameters<typeof priceOf>[1]) => naira(priceOf(s, k));
  const start = (o?: string) => `/studio/new${o ? `?occasion=${o}` : ''}`;

  return (
    <>
      <PageHead title="Brandit Studio" sub="Tell us about your event or business. We make print-ready designs, and your names and dates are spelled exactly as you typed them.">
        <div className="flex flex-wrap gap-3">
          {access.ok ? <Link href={start()} className="btn-primary">Start a design</Link> : null}
          {mine.length > 0 && <Link href="/studio/projects" className="btn-secondary">My designs ({mine.length})</Link>}
        </div>
      </PageHead>

      <div className="mx-auto grid max-w-[1160px] gap-8 px-5 pb-6">
        {sp.paid && PAID[sp.paid] && <Notice tone="good">{PAID[sp.paid]}</Notice>}
        {!access.ok && <Notice tone={access.reason === 'paused' ? 'warn' : 'neutral'}><p className="font-bold">{access.message}</p>{access.reason === 'invite' && !c && <p className="mt-1"><Link className="link" href="/signin?next=/studio">Sign in</Link> to see if you are on the list.</p>}</Notice>}

        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="What Studio promises">
          {STUDIO_PROMISES.map((t) => (
            <li key={t} className="card flex items-start gap-3 p-4"><Check className="mt-1 h-4 w-4 shrink-0 text-good" /><span className="text-[16px]">{t}</span></li>
          ))}
        </ul>

        <section aria-labelledby="how-h" className="grid gap-4">
          <h2 id="how-h" className="text-[28px]">How it works</h2>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Tell us', 'Pick the occasion and what you are printing. Type your names, date and venue. Add your photo or logo if you have one.'],
              ['See free sketches', `${s.studio_free_per_week} free sketches a week, with your own words on them, before you pay anything.`],
              ['Choose and change', 'Unlock a design, pick your favourite and ask for changes in your own words. Fixing a word costs nothing.'],
              ['Approve and print', 'We check the print is sharp at your size. You approve, and order it as a normal Brandit print job.'],
            ].map(([h, b], i) => (
              <li key={h} className="card grid content-start gap-2 p-5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-ink font-bold text-white">{i + 1}</span>
                <p className="font-display text-[20px] font-extrabold leading-tight">{h}</p>
                <p className="text-[16px] text-muted">{b}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="price-h" className="grid gap-4">
          <h2 id="price-h" className="text-[28px]">Choose how much help you want</h2>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card grid content-start gap-3 p-6">
              <p className="pill bg-placeholder text-ink w-fit">Standard</p>
              <p className="font-display text-[40px] font-extrabold leading-none tabular">{price('standard')}</p>
              <p className="text-muted">For flyers, cards, stickers, posters and shirts.</p>
              <ul className="grid gap-1.5 text-[16px]">
                {[`${std.concepts} designs to choose from`, `${std.rounds} rounds of changes (${std.perRound} new versions each)`, 'Fix any word or number free, as often as you like', 'A print-ready file, checked for sharpness', `${naira(s.studio_credit_standard_kobo)} off when you print it with Brandit`].map((t) => <li key={t} className="flex gap-2"><Check className="mt-1 h-4 w-4 shrink-0 text-good" />{t}</li>)}
              </ul>
              <p className="text-[14px] text-muted">Extra round of changes {price('round')} · Vector file {price('vector')} · Check by a Brandit designer {price('check')}</p>
            </div>
            <div className="card grid content-start gap-3 border-2 border-ink p-6">
              <p className="pill bg-accent text-ink w-fit">Premium</p>
              <p className="font-display text-[40px] font-extrabold leading-none tabular">{price('premium')}</p>
              <p className="text-muted">For big banners, roll-ups, and anything you want a person to look at.</p>
              <ul className="grid gap-1.5 text-[16px]">
                {[`${prem.concepts} drafts, then ${prem.finals} finished designs`, `${prem.rounds} rounds of edits`, 'Vector file included', `The same look on ${prem.extraProducts} more products`, `A Brandit designer checks it before print (${s.studio_check_hours})`, `${naira(s.studio_credit_premium_kobo)} off when you print it with Brandit`].map((t) => <li key={t} className="flex gap-2"><Check className="mt-1 h-4 w-4 shrink-0 text-good" />{t}</li>)}
              </ul>
              <p className="text-[14px] text-muted">Already have a Standard design? Upgrade for {price('upgrade')}.</p>
            </div>
            <div className="card grid content-start gap-3 p-6">
              <p className="pill bg-placeholder text-ink w-fit">Pack of three</p>
              <p className="font-display text-[40px] font-extrabold leading-none tabular">{price('pack3')}</p>
              <p className="text-muted">Three Standard designs for your church, shop or committee. They never expire.</p>
              {c && access.ok ? <BuyPack label={`Buy the pack for ${price('pack3')}`} /> : <Link href={c ? '#' : '/signin?next=/studio'} className="btn-secondary btn-sm w-fit">{c ? 'Not available yet' : 'Sign in to buy'}</Link>}
              <hr className="border-line" />
              <p className="font-bold">Want a person to design it?</p>
              <p className="text-[15px] text-muted">A Brandit designer can make it from scratch. Prices start from about {naira(1_200_000)}, by quote.</p>
              <Link href="/custom-order" className="link w-fit">Ask for a designer</Link>
            </div>
          </div>
          <p className="text-[14px] text-muted">All prices include VAT. If a paid design fails to make, your money is returned by itself.</p>
        </section>

        <section aria-labelledby="occ-h" className="grid gap-4">
          <h2 id="occ-h" className="text-[28px]">What are you making this for?</h2>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {OCCASIONS.filter((o) => o.id !== 'staff_id').map((o) => (
              <li key={o.id}>
                <Link href={start(o.id)} className="card grid h-full content-start gap-1 p-4 hover:border-ink">
                  <span className="font-display text-[19px] font-extrabold leading-tight">{o.label}</span>
                  <span className="text-[14px] text-muted">{o.blurb}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="rules-h" className="card grid gap-3 p-6">
          <h2 id="rules-h" className="text-[22px]">What Studio will not make</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {POLICY_SUMMARY.map((p) => <li key={p.title}><p className="font-bold">{p.title}</p><p className="text-[15px] text-muted">{p.body}</p></li>)}
          </ul>
          <p className="text-[14px] text-muted">Only your short description of the look is sent to our picture-making partners abroad. Your names, dates, phone numbers and photos stay with Brandit. <Link href="/legal/ai-designs" className="link">Read how AI designs work</Link>.</p>
        </section>
      </div>
    </>
  );
}
