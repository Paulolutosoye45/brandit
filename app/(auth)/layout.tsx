import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { Halftone } from '@/components/Brand';
import { Check } from '@/components/Bits';
import { isDemo } from '@/lib/db';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="on-dark relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Halftone cols={11} rows={20} gap={40} max={15} fit="slice" className="absolute inset-0 h-full w-full opacity-[.85]" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink from-35% via-ink/80 to-transparent" aria-hidden="true" />
        <Link href="/" aria-label="Brandit home" className="relative self-start"><Logo variant="stacked" tone="light" className="h-auto w-[340px]" priority /></Link>
        <div className="relative grid gap-8">
          <h2 className="max-w-[420px] text-[56px] leading-[1.02]">Printing without the hassle.</h2>
          <ul className="grid max-w-[380px] gap-3.5 text-[18px]">
            {['See your price and your delivery time before you pay', 'A person checks every file before it prints', 'A photo of your finished job, before it leaves us'].map((t) => (
              <li key={t} className="flex items-start gap-3"><span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-ink"><Check className="h-3.5 w-3.5" /></span>{t}</li>
            ))}
          </ul>
        </div>
        <p className="relative text-[15px] text-on-ink-muted">A Cerebre Media Africa company</p>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-2 lg:justify-end">
          <Link href="/" aria-label="Brandit home" className="lg:hidden"><Logo className="h-9 w-auto" /></Link>
          <Link href="/" className="inline-flex min-h-[44px] items-center px-2 text-[15px] font-bold text-muted hover:text-ink">Back to the site</Link>
        </header>
        {isDemo() && <aside aria-label="Demo mode" className="mx-5 mt-2 rounded-md2 bg-warn-tint px-4 py-2.5 text-[14px] text-ink lg:mx-12"><span className="font-bold">Demo mode.</span> Codes appear on screen and no real messages are sent.</aside>}
        <main id="main" className="grid flex-1 place-items-center px-5 py-8 lg:px-12">{children}</main>
        <footer className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-[13px] text-muted lg:px-12">
          <Link href="/legal/terms" className="underline underline-offset-2 hover:text-ink">Terms</Link>
          <span className="mx-2" aria-hidden="true">/</span>
          <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-ink">Privacy</Link>
        </footer>
      </div>
    </div>
  );
}
