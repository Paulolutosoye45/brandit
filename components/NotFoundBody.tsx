import Link from 'next/link';
import { Logo } from './Logo';
import { ProductArt } from './ProductArt';

/** The 404. Tells people what happened and puts the things they most likely wanted one tap away. */
export function NotFoundBody({ standalone = false }: { standalone?: boolean }) {
  return (
    <div className={`mx-auto grid max-w-[560px] justify-items-start gap-6 px-5 ${standalone ? 'min-h-screen content-center py-10' : 'py-16 sm:py-24'}`}>
      {standalone && <Link href="/" aria-label="Brandit home"><Logo variant="stacked" className="h-auto w-[300px] max-w-full" /></Link>}
      <div className="h-[120px] w-[160px] rounded-lg2 bg-warn-tint p-3"><ProductArt slug="flyers" /></div>
      <div className="grid gap-2">
        <h1 className="text-[40px] leading-[1.05] sm:text-[52px]">That page is not here.</h1>
        <p className="text-[18px] text-muted">The link may be old, or the address may have a typo. Here is where most people want to go.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/products" className="btn-primary">Start your order</Link>
        <Link href="/track" className="btn-secondary">Track an order</Link>
        <Link href="/" className="btn-ghost">Go to the home page</Link>
      </div>
    </div>
  );
}
