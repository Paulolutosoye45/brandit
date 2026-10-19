'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { naira } from '@/lib/money';
import { describeWhen } from '@/lib/time';
import { Check, Notice, StatusPill } from '@/components/Bits';
import type { Tracker } from '@/lib/tracker';
import { useLang, useT } from '@/components/LangProvider';
import type { Translate } from '@/content/pidgin-ui';

/** "Arrives today by 5pm" is built on the server from a date, so only the fixed words around the date are translated. */
function headlineText(tr: Translate, pcm: boolean, h: string) {
  const m = /^(Arrives|Ready for pickup) (.+)$/.exec(h);
  if (!m) return tr(h);
  return `${tr(m[1])} ${pcm ? m[2].replace(/ by (\d)/, ' before $1') : m[2]}`;
}

export function TrackerLive({ initial, whatsapp }: { initial: Tracker; whatsapp: string | null }) {
  const tr = useT();
  const pcm = useLang() === 'pcm';
  const [t, setT] = useState(initial);
  useEffect(() => {
    if (t.delivered) return;
    const id = setInterval(async () => {
      const r = await fetch(`/api/track/${t.token}`, { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (r) setT(r);
    }, 8000);
    return () => clearInterval(id);
  }, [t.token, t.delivered]);

  const multi = t.lines.length > 1;
  const photos = t.lines.filter((l) => l.qcPhotoFileId).map((l) => ({ id: l.itemId, name: l.name, src: `/api/files/${l.qcPhotoFileId}?t=${t.token}` }));
  return (
    <div className="mx-auto max-w-[760px] px-5 pb-12 grid gap-5">
      <div className="rounded-lg2 bg-ink text-white p-6 grid gap-2">
        <div className="flex items-center justify-between gap-3 text-[14px] text-on-ink-muted"><span>{tr('Order {code}', { code: t.code })}</span>{t.speed === '24h' && <span className="pill bg-accent text-ink">{tr('24-hour')}</span>}</div>
        <p className="font-display font-extrabold text-[30px] sm:text-[36px] leading-[1.1]" aria-live="polite">{headlineText(tr, pcm, t.headline)}</p>
        {t.subline && <p className={t.jobStatus === 'late' ? 'text-[#FFB59A]' : 'text-accent font-bold'}>{tr(t.subline)}</p>}
        <p className="text-on-ink-muted">{t.summary}</p>
        {t.deliveryWindow && <p className="text-[15px] text-on-ink-muted">{tr('Delivery window:')} <span className="font-bold text-white">{t.deliveryWindow}</span></p>}
        {t.jobStatus && t.paid && !t.delivered && <div className="pt-1"><StatusPill status={t.jobStatus} /></div>}
      </div>

      {!t.paid && <Notice tone="warn"><p className="font-bold">{tr('This order has not been paid yet.')}</p><Link className="underline font-bold" href={`/checkout/${t.orderId}`}>{tr('Continue to checkout')}</Link></Notice>}

      {t.lines.filter((l) => l.needsFileFix).map((l) => (
        <Notice key={`fix-${l.itemId}`} tone="warn"><p className="font-bold">{multi ? `${tr('We need a new file from you.')} (${l.name})` : tr('We need a new file from you.')}</p><p>{l.pausedReason}</p><Link className="btn-primary btn-sm mt-3" href={`/order/${t.orderId}/artwork?fix=1&item=${l.itemId}`}>{tr('Upload a new file')}</Link></Notice>
      ))}
      {t.lines.filter((l) => l.studioProjectId).map((l) => (
        <Notice key={`studio-${l.itemId}`} tone="warn"><p className="font-bold">{multi ? `${tr('Your Studio design is waiting for you.')} (${l.name})` : tr('Your Studio design is waiting for you.')}</p><p>{tr('Pick the design you like and approve it. Printing starts right after.')}</p><Link className="btn-primary btn-sm mt-3" href={`/studio/p/${l.studioProjectId}`}>{tr('Open my design')}</Link></Notice>
      ))}
      {t.lines.filter((l) => l.proofToken && !l.needsFileFix).map((l) => (
        <Notice key={`proof-${l.itemId}`} tone="warn"><p className="font-bold">{multi ? `${tr('Your proof is ready.')} (${l.name})` : tr('Your proof is ready.')}</p><p>{tr('Nothing prints until you approve it.')}</p><Link className="btn-primary btn-sm mt-3" href={`/proof/${l.proofToken}`}>{tr('Look at your proof')}</Link></Notice>
      ))}

      {t.riderNearby && !t.delivered && (
        <Notice tone="good"><p className="font-bold">{tr('Your rider says they are close.')}</p><p>{tr('Have your delivery code ready.')}</p></Notice>
      )}
      {t.riderLive && !t.delivered && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <div><p className="font-bold">{tr('Your rider is on the way')}</p><p className="text-[14px] text-muted">{tr('Last seen {when}. The map opens in a new tab.', { when: describeWhen(new Date(t.riderLive.updatedAt)) })}</p></div>
          <a className="btn-secondary btn-sm" href={t.riderLive.mapUrl} target="_blank" rel="noopener noreferrer">{tr('See where they are')}</a>
        </div>
      )}

      {t.deliveryCode && (
        <div className="card p-5 flex items-center justify-between gap-4 shadow-press-sm">
          <div className="min-w-0">
            <p className="font-bold">{t.pickup ? tr('Show this code when you collect it') : tr('Give the rider this code')}</p>
            {t.rider && <p className="text-[15px] text-muted">{t.rider.name}{t.rider.phone ? ` · ${t.rider.phone}` : ''}</p>}
            {t.rider?.trackingUrl && <a className="text-[15px] font-bold underline" href={t.rider.trackingUrl} target="_blank" rel="noreferrer">{tr('Track your rider')}</a>}
          </div>
          <p className="font-display font-extrabold text-[44px] tracking-[0.12em] tabular">{t.deliveryCode}</p>
        </div>
      )}

      {photos.map((ph) => (
        <figure key={ph.id} className="card p-4 grid gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ph.src} alt={tr('Photo of your finished job')} className="w-full rounded-sm2 bg-placeholder max-h-[420px] object-contain" />
          <figcaption className="text-[14px] text-muted">{multi ? `${ph.name}. ` : ''}{tr('Here is your finished job, checked and photographed before it left us.')}</figcaption>
        </figure>
      ))}

      {multi && (
        <section className="card p-5 grid gap-3" aria-label={tr('Your products')}>
          <h2 className="text-[20px]">{tr('Your products')}</h2>
          <ul className="grid divide-y divide-line">
            {t.lines.map((l) => (
              <li key={l.itemId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
                <span className="min-w-0 font-bold">{l.summary}</span>
                <span className="text-[14px] text-muted">{l.stage && l.stage !== 'paid' ? tr(l.stageLabel) : tr(l.proofText)}{l.stage && ['file_check', 'proof'].includes(l.stage) ? ` · ${tr(l.proofText)}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-5" aria-label={tr('Order progress')}>
        <ol className="grid">
          {t.steps.map((s, i) => (
            <li key={s.stage} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span className={`h-6 w-6 rounded-full grid place-items-center shrink-0 ${s.state === 'done' ? 'bg-good text-white' : s.state === 'current' ? 'bg-accent ring-[3px] ring-ink' : 'bg-surface border-2 border-line-control'}`}>
                  {s.state === 'done' && <Check className="h-3.5 w-3.5" />}
                </span>
                {i < t.steps.length - 1 && <span className={`w-0.5 flex-1 min-h-[20px] ${s.state === 'done' ? 'bg-good' : 'bg-line'}`} />}
              </div>
              <div className="pb-5 flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className={`font-bold ${s.state === 'current' ? 'text-[18px]' : ''} ${s.state === 'todo' ? 'text-muted' : ''}`}>{tr(s.label)}</p>
                  {s.at && <p className="text-[13px] text-muted whitespace-nowrap">{describeWhen(new Date(s.at))}</p>}
                </div>
                {s.state === 'current' && s.note && <p className="text-[14px] text-muted">{tr(s.note)}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-wrap gap-3">
        {t.delivered && t.canReport && <Link className="btn-secondary btn-sm" href={`/order/${t.token}/problem`}>{tr('Report a problem')}</Link>}
        {t.delivered && !t.hasReview && <Link className="btn-primary btn-sm" href={`/order/${t.token}/review`}>{tr('Leave a review')}</Link>}
        {t.paid && <Link className="btn-secondary btn-sm" href={`/invoice/${t.token}`}>{t.businessInvoice ? tr('VAT invoice') : tr('Receipt')}</Link>}
        {whatsapp && <a className="btn-secondary btn-sm" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hi Brandit, about order ${t.code}`)}`}>{tr('Message us on WhatsApp')}</a>}
      </div>
      <p className="text-[13px] text-muted">{tr('Total paid {amount}. This page updates by itself.', { amount: t.paid ? naira(t.totalKobo) : '—' })}</p>
    </div>
  );
}
