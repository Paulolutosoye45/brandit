import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCampaign, lagosToday } from '@/lib/campaigns';
import { phaseOf, leftText, niceDay, THEMES, themeOf } from '@/lib/campaignCore';
import { listCatalog } from '@/lib/catalog';
import { listTemplates, templatePrice } from '@/lib/templates';
import { findCoupon } from '@/lib/coupons';
import { couponLabel } from '@/lib/couponCore';
import { getStaff } from '@/lib/session';
import { ProductTile } from '@/components/ProductTile';
import { TemplateCard } from '@/components/TemplateCard';
import { SaveCode } from '@/components/SaveCode';
import { ViewBeacon } from '@/components/ViewBeacon';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const c = await getCampaign(slug);
  if (!c || !c.active) return { title: 'Season', robots: { index: false } };
  const live = phaseOf(c, lagosToday()) === 'live';
  return { title: c.title, description: c.intro || c.headline, robots: live ? undefined : { index: false } };
}

export default async function Season(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const c = await getCampaign(slug);
  const staff = c ? await getStaff().catch(() => null) : null;
  if (!c || (!c.active && !staff)) notFound();
  const today = lagosToday();
  const phase = phaseOf(c, today);
  const p = THEMES[themeOf(c.theme)];

  if (phase !== 'live' && !staff) {
    return (
      <div className="mx-auto grid max-w-[640px] gap-5 px-5 py-20 text-center">
        <h1 className="text-[34px] leading-[1.05]">{c.title}</h1>
        <p className="text-[18px] text-muted">{phase === 'upcoming' && c.starts_on ? `This season starts on ${niceDay(c.starts_on)}. Come back then, or print what you need today.` : 'This season has ended. You can still order anything from our list today.'}</p>
        <div className="flex flex-wrap justify-center gap-3"><Link href="/products" className="btn-primary">See all products</Link><Link href="/templates" className="btn-secondary">Start from a template</Link></div>
      </div>
    );
  }

  const [catalog, allTemplates, coupon] = await Promise.all([listCatalog(), listTemplates(), c.coupon_code ? findCoupon(c.coupon_code) : Promise.resolve(null)]);
  const cards = c.product_slugs.map((s) => catalog.find((x) => x.product.slug === s)).filter((x): x is NonNullable<typeof x> => !!x);
  const templates = c.template_slugs.map((s) => allTemplates.find((t) => t.slug === s)).filter((t): t is NonNullable<typeof t> => !!t);
  const prices = await Promise.all(templates.map((t) => templatePrice(t).catch(() => null)));
  const codeOk = !!coupon && coupon.active && (!coupon.ends_at || new Date(coupon.ends_at) > new Date()) && (!coupon.starts_at || new Date(coupon.starts_at) <= new Date());
  const left = leftText(c, today);
  const light = ['cream', 'white'].includes(themeOf(c.theme));

  return (
    <>
      {phase === 'live' && !staff && <ViewBeacon name="campaign_view" slug={c.slug} />}
      {staff && phase !== 'live' && (
        <p className="bg-warn-tint px-5 py-2 text-center text-[14px] font-bold">Staff preview: this page is {c.active ? phase : 'hidden'} for customers right now.</p>
      )}
      <section style={{ background: p.bg, color: p.fg }} className={light ? '' : 'on-dark'}>
        <div className="mx-auto grid max-w-[1160px] gap-5 px-5 py-14 sm:py-20">
          {left && <p className="pill self-start" style={{ background: p.accent, color: '#0B1F33' }}>{left}</p>}
          <h1 className="max-w-[760px] text-[40px] leading-[1.02] sm:text-[64px]" style={{ color: p.fg }}>{c.headline}</h1>
          {c.intro && <p className="max-w-[640px] text-[18px] leading-snug sm:text-[20px]" style={{ color: p.fg, opacity: 0.88 }}>{c.intro}</p>}
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href={templates.length ? '#templates' : '#products'} className="btn-primary !px-8 text-[18px]">{templates.length ? 'Start from a template' : 'See what to order'}</Link>
            <Link href="/plan-event" className="btn-secondary !px-8 text-[18px]" style={{ background: 'transparent', color: p.fg, borderColor: p.fg }}>Plan my event</Link>
          </div>
        </div>
      </section>

      {(c.last_order_note || (codeOk && coupon)) && (
        <section className="mx-auto grid max-w-[1160px] gap-4 px-5 pt-8 md:grid-cols-2">
          {c.last_order_note && (
            <div className="card grid content-start gap-1 p-5"><p className="text-[13px] font-bold uppercase tracking-wide text-muted">Order in time</p><p className="text-[17px]">{c.last_order_note}</p>{c.ends_on && <p className="text-[14px] text-muted">This season runs until {niceDay(c.ends_on)}.</p>}</div>
          )}
          {codeOk && coupon && (
            <div className="card grid content-start gap-2 border-2 border-ink p-5">
              <p className="text-[13px] font-bold uppercase tracking-wide text-muted">A little something for this season</p>
              <p className="text-[17px]"><span className="font-display text-[24px] font-extrabold tabular">{coupon.code}</span> gives you {coupon.description?.trim() || couponLabel(coupon)}.</p>
              <SaveCode code={coupon.code} />
            </div>
          )}
        </section>
      )}

      {templates.length > 0 && (
        <section id="templates" className="mx-auto max-w-[1160px] px-5 pt-14">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><h2 className="text-[30px] leading-[1.05] sm:text-[40px]">Start from a template</h2><Link href="/templates" className="link">See all templates</Link></div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {templates.map((t, i) => <TemplateCard key={t.id} t={t} totalKobo={prices[i] ? prices[i]!.printKobo + prices[i]!.designKobo : null} />)}
          </div>
        </section>
      )}

      {cards.length > 0 && (
        <section id="products" className="mx-auto max-w-[1160px] px-5 pt-14">
          <h2 className="mb-6 text-[30px] leading-[1.05] sm:text-[40px]">Popular for this season</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {cards.map(({ product: pr, from, cover, coverAlt, fast }, i) => <ProductTile key={pr.id} slug={pr.slug} name={pr.name} from={from} index={i} fast={fast} cover={cover} coverAlt={coverAlt} />)}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-[1160px] px-5 pt-14">
        <div className="grid items-center gap-5 rounded-lg2 bg-accent p-7 text-ink sm:p-10 lg:grid-cols-[1.5fr_1fr]">
          <div className="grid gap-2"><h2 className="text-[28px] leading-[1.05] sm:text-[36px]">Printing for a whole event?</h2><p className="text-[17px]">Tell us once: the date, the guests and what you need. You get one price for everything.</p></div>
          <div className="lg:justify-self-end"><Link href="/plan-event" className="btn-dark !px-8 text-[18px]">Plan my event</Link></div>
        </div>
      </section>
    </>
  );
}
