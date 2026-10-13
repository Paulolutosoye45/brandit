import Link from 'next/link';
import { BottomNav } from './BottomNav';
import { Logo } from './Logo';
import { Avatar } from './Brand';
import { WhatsAppFab } from './WhatsAppFab';
import { CouponCapture } from './CouponCapture';
import { ResumeOrder } from './ResumeOrder';
import { InstallPrompt } from './InstallPrompt';
import { ServiceWorker } from './ServiceWorker';
import { LangProvider } from './LangProvider';
import { LangSwitch } from './LangSwitch';
import { getCustomer } from '@/lib/session';
import { getLang } from '@/lib/lang';
import { getSettings } from '@/lib/settings';
import { runnable } from '@/lib/studio/config';
import { translator, type Translate } from '@/content/pidgin-ui';

export function Header({ customer, t, studio = false }: { customer: { name: string | null; email: string | null } | null; t: Translate; studio?: boolean }) {
  const first = customer?.name?.split(' ')[0];
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-[64px] max-w-[1160px] items-center justify-between gap-6 px-5">
        <Link href="/" aria-label="Brandit home" className="inline-flex min-h-[44px] items-center"><Logo className="h-9 w-auto" priority /></Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {[['/products', 'Products', ''], ['/templates', 'Templates', ''], ...(studio ? [['/studio', 'Studio', '']] : []), ['/plan-event', 'Plan an event', 'hidden lg:inline-flex'], ['/custom-order', 'Custom order', 'hidden xl:inline-flex'], ['/track', 'Track order', ''], ['/help', 'Help', '']].map(([href, label, vis]) => (
            <Link key={href} href={href} className={`${vis || 'inline-flex'} min-h-[44px] items-center rounded-sm2 px-3 font-medium hover:bg-paper2 lg:px-3.5`}>{t(label)}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {customer ? (
            <Link href="/account" aria-label={first ? `${first}, my account` : 'My account'} className="inline-flex min-h-[44px] items-center gap-2.5 rounded-full py-1 pl-1 pr-3 hover:bg-paper2">
              <Avatar name={customer.name ?? customer.email} className="h-9 w-9 text-[16px]" />
              {first && <span className="hidden font-bold lg:inline">{first}</span>}
            </Link>
          ) : (
            <Link href="/signin" className="btn-ghost btn-sm">{t('Sign in')}</Link>
          )}
          <Link href="/products" className="btn-primary btn-sm hidden md:inline-flex">{t('Start your order')}</Link>
        </div>
      </div>
    </header>
  );
}

export function Footer({ t, showLang, studio = false }: { t: Translate; showLang: boolean; studio?: boolean }) {
  const wa = process.env.NEXT_PUBLIC_WHATSAPP;
  const link = 'inline-flex min-h-[32px] items-center text-on-ink-muted hover:text-white';
  return (
    <footer className="on-dark relative mt-24 overflow-hidden bg-ink pb-24 text-white md:pb-0">
      <div className="relative mx-auto grid max-w-[1160px] gap-10 px-5 py-14 sm:grid-cols-2 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div className="grid content-start gap-3">
          <Logo tone="light" className="h-11 w-auto" />
          <p className="max-w-[260px] text-[15px] text-on-ink-muted">{t('Printing without the hassle. Design and print for Lagos.')}</p>
          <p className="text-[14px] text-on-ink-muted">{t('A Cerebre Media Africa company')}</p>
          {showLang && <div className="mt-1"><LangSwitch tone="dark" /></div>}
        </div>
        <div className="grid content-start gap-1 text-[15px]">
          <p className="mb-1 font-bold">{t('Order')}</p>
          <Link className={link} href="/products">{t('All products')}</Link>
          <Link className={link} href="/templates">{t('Templates')}</Link>
          {studio && <Link className={link} href="/studio">{t('Brandit Studio')}</Link>}
          <Link className={link} href="/plan-event">{t('Plan an event')}</Link>
          <Link className={link} href="/custom-order">{t('Custom order')}</Link>
          <Link className={link} href="/business">{t('For businesses')}</Link>
          <Link className={link} href="/track">{t('Track an order')}</Link>
          <Link className={link} href="/account">{t('My account')}</Link>
        </div>
        <div className="grid content-start gap-1 text-[15px]">
          <p className="mb-1 font-bold">{t('Help')}</p>
          <Link className={link} href="/faq">{t('Questions and answers')}</Link>
          <Link className={link} href="/help#promise">{t('The Brandit Promise')}</Link>
          <Link className={link} href="/delivery">{t('Delivery areas and fees')}</Link>
          <Link className={link} href="/help#files">{t('Getting your file right')}</Link>
          <Link className={link} href="/legal/refunds">{t('Reprints and refunds')}</Link>
        </div>
        <div className="grid content-start gap-1 text-[15px]">
          <p className="mb-1 font-bold">{t('Talk to a person')}</p>
          {wa && <a className={link} href={`https://wa.me/${wa}`}>{t('Message us on WhatsApp')}</a>}
          <Link className={link} href="/contact">{t('Contact and hours')}</Link>
          <Link className={link} href="/about">{t('About Brandit')}</Link>
          <p className="text-on-ink-muted">{t('Monday to Saturday, 8am to 6pm')}</p>
        </div>
      </div>
      <div className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-3 px-5 py-5 text-[13px] text-on-ink-muted">
          <p>© {new Date().getFullYear()} Brandit. Lagos, Nigeria.</p>
          <p className="flex flex-wrap gap-x-5 gap-y-1"><Link className="inline-flex min-h-[32px] items-center hover:text-white" href="/legal/terms">Terms</Link><Link className="inline-flex min-h-[32px] items-center hover:text-white" href="/legal/refunds">Refunds</Link><Link className="inline-flex min-h-[32px] items-center hover:text-white" href="/legal/privacy">Privacy</Link>{studio && <Link className="inline-flex min-h-[32px] items-center hover:text-white" href="/legal/ai-designs">AI designs</Link>}</p>
        </div>
      </div>
    </footer>
  );
}

export async function SiteChrome({ children }: { children: React.ReactNode }) {
  const [c, lang, settings] = await Promise.all([getCustomer(), getLang(), getSettings()]);
  const t = translator(lang);
  return (
    <LangProvider lang={lang}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-accent focus:p-3 focus:text-ink">{t('Skip to content')}</a>
      <Header customer={c ? { name: c.name, email: c.email } : null} t={t} studio={settings.studio_enabled && runnable()} />
      <CouponCapture />
      <ResumeOrder />
      <main id="main" className="min-h-[60vh] pb-20 md:pb-0">{children}</main>
      <Footer t={t} showLang={settings.pidgin_enabled} studio={settings.studio_enabled && runnable()} />
      <InstallPrompt />
      <BottomNav signedIn={!!c} />
      <ServiceWorker />
      {process.env.NEXT_PUBLIC_WHATSAPP && <WhatsAppFab number={process.env.NEXT_PUBLIC_WHATSAPP} />}
    </LangProvider>
  );
}
