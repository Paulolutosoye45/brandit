import Link from 'next/link';
import { listCatalog, listZones, quantitySteps } from '@/lib/catalog';
import { featuredReviews } from '@/lib/publicReviews';
import { getSettings } from '@/lib/settings';
import { scores } from '@/lib/reports';
import { HeroQuote } from '@/components/HeroQuote';
import { ProductTile } from '@/components/ProductTile';
import { Check } from '@/components/Bits';
import { Halftone } from '@/components/Brand';
import { getCustomer } from '@/lib/session';
import { getLang } from '@/lib/lang';
import { translator } from '@/content/pidgin-ui';
import { homeCampaign, lagosToday } from '@/lib/campaigns';
import { leftText, THEMES, themeOf } from '@/lib/campaignCore';
import { listTemplates, templatePrice } from '@/lib/templates';
import { TemplateCard } from '@/components/TemplateCard';

export const dynamic = 'force-dynamic';

const STEPS = [
  ['Pick and see the price', 'Choose a product and a quantity. The price and the delivery time appear at once.'],
  ['Upload, or we design it', 'Your file is checked in seconds. No design yet? Tell us what you need and we create it.'],
  ['We check it and show you', 'A named person checks your file. You approve a preview, and you get a photo of the finished job.'],
  ['Delivered to your door', 'Track your order and your rider. Updates arrive at every stage without you asking.'],
];

export default async function Home(props: { searchParams: Promise<{ deleted?: string }> }) {
  const sp = await props.searchParams;
  const [catalog, zones, sc, reviews, me, settings, lang, season, allTemplates] = await Promise.all([listCatalog(), listZones(), scores(), featuredReviews(3), getCustomer(), getSettings(), getLang(), homeCampaign(), listTemplates()]);
  const t = translator(lang);
  const shownTemplates = allTemplates.slice(0, 4);
  const templatePrices = await Promise.all(shownTemplates.map((x) => templatePrice(x).catch(() => null)));
  const seasonLeft = season ? leftText(season, lagosToday()) : null;
  const sp_ = season ? THEMES[themeOf(season.theme)] : null;
  // The live example in the hero: business cards when we sell them, otherwise the first product priced by quantity.
  const heroCard = catalog.find((c) => c.product.slug === 'business-cards' && c.product.pricing_mode === 'tier') ?? catalog.find((c) => c.product.pricing_mode === 'tier');
  const heroQty = heroCard ? await quantitySteps(heroCard.product.id) : [];
  const shown = catalog.slice(0, 7);
  const wa = process.env.NEXT_PUBLIC_WHATSAPP;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${base}/#brandit`,
    name: 'Brandit',
    description: 'Design and print in Lagos. See your price and your delivery time before you pay.',
    url: base,
    logo: `${base}/brand/logo.png`,
    image: `${base}/brand/logo.png`,
    areaServed: { '@type': 'City', name: 'Lagos' },
    address: { '@type': 'PostalAddress', addressLocality: 'Lagos', addressCountry: 'NG' },
    openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '08:00', closes: '18:00' }],
    parentOrganization: { '@type': 'Organization', name: 'Cerebre Media Africa' },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
      {sp.deleted && <p role="status" className="bg-good-tint px-5 py-3 text-center text-[15px] font-bold text-good">Your account has been deleted. Thank you for printing with us.</p>}
      <section className="relative overflow-hidden">
        <Halftone cols={13} rows={13} gap={44} max={17} className="pointer-events-none absolute -right-16 top-0 hidden h-[620px] w-auto opacity-[.55] lg:block" />
        <div className="relative mx-auto grid max-w-[1160px] items-center gap-14 px-5 pb-20 pt-10 sm:pt-14 lg:grid-cols-[1.08fr_1fr] lg:pb-24">
          <div className="grid gap-7">
            <h1 className="text-[46px] leading-[0.98] sm:text-[68px] lg:text-[80px]">{t('Printing without the hassle.')}</h1>
            <p className="max-w-[500px] text-[20px] leading-snug text-muted">{t('See your price and your delivery time before you pay. Upload a file or let us design it. We check it, print it and bring it to you.')}</p>
            <div className="flex flex-wrap gap-3.5">
              <Link href="/products" className="btn-primary !px-8 text-[18px]">{t('Start your order')}</Link>
              {wa ? <a href={`https://wa.me/${wa}`} className="btn-secondary !px-8 text-[18px]">{t('Order on WhatsApp')}</a> : <Link href="/help#promise" className="btn-secondary !px-8 text-[18px]">{t('How the Promise works')}</Link>}
            </div>
            <ul className="grid gap-2.5 text-[16px] font-medium">
              {['Card, bank transfer or USSD', 'A person checks every file before it prints', 'Printed wrong? We reprint or refund'].map((line) => (
                <li key={line} className="flex items-center gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-good-tint text-good"><Check className="h-3.5 w-3.5" /></span>{t(line)}</li>
              ))}
            </ul>
          </div>
          {heroCard && heroQty.length > 0 ? (
            <HeroQuote defaultArea={me?.default_area ?? null} zones={zones.map((z) => ({ id: z.id, name: z.name, areas: z.areas }))} qtys={heroQty} slug={heroCard.product.slug} name={heroCard.product.name} />
          ) : (
            <div className="card grid gap-4 rounded-lg2 border-ink p-7 shadow-press">
              <p className="font-display text-[26px] font-extrabold leading-tight">Tell us what you need.</p>
              <p className="text-muted">Pick a product to see your price and delivery time, or describe something special and a person sends you a price.</p>
              <Link href="/products" className="btn-primary">See the products</Link>
            </div>
          )}
        </div>
      </section>


      {season && sp_ && (
        <section aria-label={season.title} className="mx-auto max-w-[1160px] px-5 pb-12">
          <Link href={`/season/${season.slug}`} style={{ background: sp_.bg, color: sp_.fg }} className="group grid items-center gap-3 rounded-lg2 p-6 sm:grid-cols-[1fr_auto] sm:p-8">
            <span className="grid gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="pill" style={{ background: sp_.accent, color: '#0B1F33' }}>{season.title}</span>
                {seasonLeft && <span className="text-[14px] font-bold" style={{ color: sp_.accent }}>{seasonLeft}</span>}
              </span>
              <span className="font-display text-[26px] font-extrabold leading-tight sm:text-[32px]">{season.headline}</span>
              {season.last_order_note && <span className="text-[15px] opacity-85">{season.last_order_note}</span>}
            </span>
            <span className="btn-primary btn-sm self-start sm:self-center">{t('See the offers')}</span>
          </Link>
        </section>
      )}

      <section id="products" className="mx-auto max-w-[1160px] px-5 pb-20">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-[36px] leading-[1.05] sm:text-[48px]">{t('What do you need printed?')}</h2>
          <p className="max-w-[300px] text-muted">{t('One price, with the delivery time shown before you pay.')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {shown.map(({ product: p, from, cover, coverAlt, fast }, i) => (
            <ProductTile key={p.id} slug={p.slug} name={p.name} from={from} blurb={i === 0 ? p.blurb : undefined} index={i} featured={i === 0 && shown.length > 3} fast={fast} cover={cover} coverAlt={coverAlt} />
          ))}
          <Link href="/custom-order" className="group col-span-2 flex flex-col justify-between gap-5 rounded-lg2 border-2 border-dashed border-line-control bg-surface p-6 hover:border-ink">
            <div className="grid gap-2">
              <p className="font-display text-[22px] font-extrabold leading-tight">{t('Need something different?')}</p>
              <p className="text-[15px] text-muted">Odd sizes, special paper, big quantities. Describe it and a person sends you a price.</p>
            </div>
            <span className="btn-secondary btn-sm self-start group-hover:bg-paper2">{t('Ask for a custom price')}</span>
          </Link>
        </div>
        {catalog.length > shown.length && <p className="mt-6"><Link href="/products" className="btn-secondary">{t('See all products')} ({catalog.length})</Link></p>}
      </section>


      {shownTemplates.length > 0 && (
        <section aria-labelledby="tpl-h" className="mx-auto max-w-[1160px] px-5 pb-20">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
            <h2 id="tpl-h" className="text-[36px] leading-[1.05] sm:text-[48px]">{t('Start from a template')}</h2>
            <Link href="/templates" className="btn-secondary btn-sm">{t('See all templates')}</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {shownTemplates.map((x, i) => <TemplateCard key={x.id} t={x} totalKobo={templatePrices[i] ? templatePrices[i]!.printKobo + templatePrices[i]!.designKobo : null} />)}
          </div>
        </section>
      )}

      <section id="how" className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-[1160px] gap-12 px-5 py-20">
          <h2 className="max-w-[640px] text-[36px] leading-[1.05] sm:text-[48px]">{t('Four steps. No visits, no follow-up calls.')}</h2>
          <ol className="relative grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <span aria-hidden="true" className="absolute left-[22px] right-[22px] top-[22px] hidden border-t-2 border-dashed border-line-control lg:block" />
            {STEPS.map(([title, d], i) => (
              <li key={title} className="relative grid content-start gap-3">
                <span className="relative grid h-11 w-11 place-items-center rounded-full bg-accent font-display text-[20px] font-extrabold ring-8 ring-surface">{i + 1}</span>
                <p className="text-[20px] font-bold leading-tight">{t(title)}</p>
                <p className="text-muted">{t(d)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>


      <section aria-labelledby="plan-h" className="mx-auto max-w-[1160px] px-5 pb-4">
        <div className="grid items-center gap-6 rounded-lg2 border-2 border-ink bg-surface p-7 sm:p-10 lg:grid-cols-[1.4fr_1fr]">
          <div className="grid gap-2">
            <h2 id="plan-h" className="text-[30px] leading-[1.05] sm:text-[40px]">{t('Planning an event?')}</h2>
            <p className="max-w-[520px] text-[18px] text-muted">{t('Tell us once. Get one price for everything that needs printing.')}</p>
          </div>
          <div className="lg:justify-self-end"><Link href="/plan-event" className="btn-primary !px-8 text-[18px]">{t('Plan my event')}</Link></div>
        </div>
      </section>

      <section aria-labelledby="custom-h" className="mx-auto max-w-[1160px] px-5 py-20">
        <div className="grid items-center gap-8 rounded-lg2 bg-accent p-8 text-ink sm:p-12 lg:grid-cols-[1.4fr_1fr]">
          <div className="grid gap-3">
            <h2 id="custom-h" className="text-[32px] leading-[1.05] sm:text-[44px]">{t('Not on the list? We still print it.')}</h2>
            <p className="max-w-[520px] text-[18px]">Tell us what you want, with a size, a quantity and a picture if you have one. A person replies with a price, usually within {settings.custom_reply_hours} hours. You pay only when you accept it.</p>
          </div>
          <div className="grid gap-3 lg:justify-items-end">
            <Link href="/custom-order" className="btn-dark !px-8 text-[18px]">{t('Ask for a price')}</Link>
            <p className="text-[14px] font-medium">{t('Free. No obligation.')}</p>
          </div>
        </div>
      </section>

      <section className="on-dark relative overflow-hidden bg-ink text-white">
        <Halftone cols={12} rows={9} gap={46} max={17} className="pointer-events-none absolute -right-10 bottom-0 hidden h-[420px] w-auto opacity-30 lg:block" />
        <div className="relative mx-auto grid max-w-[1160px] items-center gap-12 px-5 py-20 lg:grid-cols-[1.5fr_1fr]">
          <div className="grid gap-8">
            <h2 className="text-[36px] leading-[1.05] sm:text-[48px]">{t('The Brandit Promise')}</h2>
            <div className="grid gap-6">
              {[
                ['Printed wrong? We reprint or refund.', 'If the job does not match the file you approved, we fix it at no cost.'],
                ['Late on a 24-hour order? Delivery is on us.', 'The delivery fee comes back automatically. You do not have to ask.'],
                ['A person answers.', 'We reply on WhatsApp within 15 minutes, Monday to Saturday, 8am to 6pm.'],
              ].map(([title, d]) => (
                <div key={title} className="grid gap-1 border-l-4 border-accent pl-5"><p className="text-[21px] font-bold leading-tight">{t(title)}</p><p className="text-on-ink-muted">{d}</p></div>
              ))}
            </div>
            <Link href="/help#promise" className="btn-primary self-start">{t('Read the full Promise')}</Link>
          </div>
          <div className="grid gap-6 rounded-lg2 bg-surface p-8 text-ink">
            {sc.onTime != null && sc.rightFirstTime != null ? (
              <>
                <div><p className="font-display text-[64px] font-extrabold leading-none tabular">{sc.onTime}%</p><p className="mt-1 text-muted">of 24-hour orders arrived on time, last 30 days.</p></div>
                <div className="border-t border-line pt-6"><p className="font-display text-[64px] font-extrabold leading-none tabular">{sc.rightFirstTime}%</p><p className="mt-1 text-muted">of orders were right first time.</p></div>
              </>
            ) : (
              <div className="grid gap-2">
                <p className="font-display text-[28px] font-extrabold leading-tight">We publish our own scores.</p>
                <p className="text-muted">Two live figures appear here after our first {sc.needed} deliveries: how many 24-hour orders arrive on time, and how many are right first time.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {reviews.length > 0 && (
        <section aria-labelledby="reviews-h" className="mx-auto max-w-[1160px] px-5 pt-20">
          <h2 id="reviews-h" className="mb-8 text-[36px] leading-[1.05] sm:text-[48px]">{t('What customers say')}</h2>
          <ul className={`grid gap-4 ${reviews.length > 1 ? 'md:grid-cols-2 lg:grid-cols-3' : 'max-w-[640px]'}`}>
            {reviews.map((r) => (
              <li key={r.id} className="card grid content-between gap-4 p-6">
                <div className="grid gap-2">
                  {r.has_photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/review-photos/${r.id}?size=thumb`} alt={`${r.product || 'Printed item'} delivered to a customer`} className="mb-1 h-[180px] w-full rounded-lg border border-line object-cover" loading="lazy" width={480} height={180} />
                  )}
                  <p aria-label={`${r.rating} out of 5 stars`} className="text-[20px] tracking-wider text-ink" role="img">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</p>
                  <blockquote className="text-[17px] leading-snug">&ldquo;{r.body}&rdquo;</blockquote>
                </div>
                <p className="text-[14px] font-bold text-muted">{[r.first_name, r.product].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mx-auto grid max-w-[1160px] items-center gap-10 px-5 py-20 lg:grid-cols-[1fr_1.4fr]">
        <div className="grid gap-5">
          <h2 className="text-[36px] leading-[1.05] sm:text-[48px]">{t('Printing for a business?')}</h2>
          <p className="text-[18px] text-muted">Reorder in one tap, get VAT invoices, and have orders delivered with no Brandit branding when you are printing for your own clients.</p>
          <Link href="/signin?next=/account" className="btn-dark self-start">{t('Open your account')}</Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[['Same again', 'Reorder a past job with its approved file, at today\'s price.'], ['Proper invoices', 'A pro-forma before you pay and a VAT invoice after.'], ['Plain-pack delivery', 'For agencies and designers: no Brandit name on the packing slip or messages.'], ['Deadline check', 'Tell us when you need it. We say yes or no before you pay.']].map(([t, d]) => (
            <div key={t} className="card p-6"><p className="text-[19px] font-bold">{t}</p><p className="mt-1 text-[15px] text-muted">{d}</p></div>
          ))}
        </div>
      </section>
    </>
  );
}
