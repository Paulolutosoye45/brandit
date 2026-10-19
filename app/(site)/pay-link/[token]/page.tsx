import Link from 'next/link';
import { notFound } from 'next/navigation';
import { payLinkView } from '@/lib/payLink';
import { naira } from '@/lib/money';
import { Notice, PageHead } from '@/components/Bits';
import { PayLinkForm } from './PayLinkForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pay for an order', robots: { index: false, follow: false } };

/**
 * The page a shared pay link opens. It shows what is being paid for, the price and the delivery time, and takes the payment
 * from whoever opened it. It does not show the street address or the phone number of the person who ordered.
 */
export default async function PayLinkPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const v = await payLinkView(token);
  if (!v) notFound();

  if (v.state === 'paid') {
    return (
      <>
        <PageHead title="This order is paid" sub={`Order ${v.code}. Thank you${v.who ? `, from ${v.who} and from us` : ''}.`} />
        <div className="mx-auto max-w-[620px] px-5 pb-12 grid gap-4">
          <Notice tone="good">The payment went through, and {v.who} has been told. Nothing more for you to do. Paystack sends your receipt by email.</Notice>
          <Link href="/" className="btn-secondary self-start">Visit Brandit</Link>
        </div>
      </>
    );
  }
  if (v.state === 'closed') {
    return (
      <>
        <PageHead title="This link cannot be paid right now" sub="No money has been taken." />
        <div className="mx-auto max-w-[620px] px-5 pb-12 grid gap-4">
          <Notice tone="warn">{v.reason}</Notice>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead title={`${v.who} asked you to pay for this`} sub={`Order ${v.code}${v.business ? ` · ${v.business}` : ''}. Check it, then pay by card, bank transfer or USSD.`} />
      <div className="mx-auto max-w-[1000px] px-5 pb-16 grid gap-6 md:grid-cols-[1fr_380px] items-start">
        <section className="card p-6 grid gap-4" aria-label="What you are paying for">
          {v.note && (
            <blockquote className="rounded-md2 bg-paper2 px-4 py-3 text-[16px]">
              <p className="text-[13px] font-bold text-muted">A note from {v.who}</p>
              <p>{v.note}</p>
            </blockquote>
          )}
          <ul className="grid gap-4" aria-label="In this order">
            {v.lines.map((l, i) => (
              <li key={i} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[18px] font-bold leading-tight">{l.name}</p>
                  <p className="text-[15px] text-muted">{l.detail}</p>
                  {l.choices.length > 0 && <p className="text-[13px] text-muted">{l.choices.join(' · ')}</p>}
                </div>
                {v.lines.length > 1 && <p className="shrink-0 text-[16px] font-bold tabular">{naira(l.kobo)}</p>}
              </li>
            ))}
          </ul>
          <dl className="grid gap-2 text-[16px] tabular border-t border-line pt-4">
            <div className="flex justify-between gap-3"><dt>Print</dt><dd>{naira(v.printKobo)}</dd></div>
            {v.designKobo > 0 && <div className="flex justify-between"><dt>Design fee</dt><dd>{naira(v.designKobo)}</dd></div>}
            <div className="flex justify-between gap-3"><dt>{v.deliveryText}</dt><dd>{v.deliveryKobo > 0 ? naira(v.deliveryKobo) : 'Free'}</dd></div>
            {v.discountKobo > 0 && <div className="flex justify-between gap-3 text-good"><dt>Discount</dt><dd>−{naira(v.discountKobo)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-3 mt-1 items-baseline"><dt className="font-bold">Total</dt><dd className="font-display font-extrabold text-[32px] leading-none">{naira(v.totalKobo)}</dd></div>
          </dl>
          <p className="text-[13px] text-muted text-right">Includes VAT of {naira(v.vatKobo)}</p>
          {v.arrival ? (
            <div className="rounded-md2 bg-good-tint px-4 py-3"><p className="font-display font-extrabold text-[20px] leading-tight">{v.arrival}</p></div>
          ) : v.designAny ? (
            <Notice tone="neutral">A designer or Brandit Studio makes the artwork first. {v.who} approves it before anything prints, and the arrival time is set then.</Notice>
          ) : null}
          {v.fileLater && <Notice tone="neutral">{v.who} sends the artwork file after the payment. Printing starts when it is checked.</Notice>}
        </section>
        <PayLinkForm token={token} totalKobo={v.totalKobo} who={v.who} />
      </div>
    </>
  );
}
