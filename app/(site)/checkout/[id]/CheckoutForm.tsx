'use client';
import { WINDOWS } from '@/lib/windows';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { naira } from '@/lib/money';
import { priceOrder } from '@/lib/pricing';
import { discountFor, type CouponRule } from '@/lib/couponCore';
import { Notice } from '@/components/Bits';
import type { PublicQuote } from '@/components/PromiseCard';
import { useT } from '@/components/LangProvider';
import { useOrderSheet } from '@/components/builder/OrderSheet';
import { CheckoutSignIn } from './CheckoutSignIn';

type Zone = { id: string; name: string; areas: string[]; feeKobo: number };
export type AppliedCoupon = { code: string; label: string; rule: CouponRule; productIds?: string[] };
export type CheckoutLine = {
  id: string; productId: string; slug: string; name: string; qtyText: string; choices: string[];
  priceKobo: number; designKobo: number; designPath: boolean; studioPath?: boolean;
  quote: { slug: string; quantity: number; config: Record<string, string>; sizeKey?: string; widthFt?: number; heightFt?: number };
};
type Props = {
  orderId: string;
  lines: CheckoutLine[];
  /** Set for custom orders: the number of working days the quote promised, counted from proof approval. */
  custom: { days: number | null; code: string } | null;
  zones: Zone[];
  holdExpiresAt: string | null;
  vatRate: number;
  pricesIncludeVat: boolean;
  coupon: AppliedCoupon | null;
  pickupAddress: string;
  windowsEnabled: boolean;
  /** Set when the customer is not signed in and can be: the sign-in card shows instead of the form. */
  signIn: { google: boolean; email: boolean; demo: boolean } | null;
  defaults: { name: string; phone: string; email: string; company: string; taxId: string; area: string; address: string; pickup: boolean; plainPack: boolean; window: string };
};

export function CheckoutForm({ orderId, lines, custom, zones, holdExpiresAt, vatRate, pricesIncludeVat, coupon: initialCoupon, pickupAddress, windowsEnabled, signIn, defaults }: Props) {
  const tr = useT();
  const sheet = useOrderSheet();
  const itemsKobo = lines.map((l) => l.priceKobo);
  const printKobo = itemsKobo.reduce((a, b) => a + b, 0);
  const designKobo = lines.reduce((a, l) => a + l.designKobo, 0);
  const designAny = lines.some((l) => l.designPath);
  const multi = lines.length > 1;
  const [f, setF] = useState(defaults);
  const [q, setQ] = useState<PublicQuote | null>(null);
  const [err, setErr] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [holdLeft, setHoldLeft] = useState<number | null>(null);
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(initialCoupon);
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [couponMsg, setCouponMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const seq = useRef(0);
  const autoTried = useRef(false);
  // "Ask someone else to pay": the same checks as paying, then a link instead of a payment.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareNote, setShareNote] = useState('');
  const [shareLink, setShareLink] = useState<{ url: string; total: number; code: string } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('brandit.area');
    if (!defaults.area && saved && zones.some((z) => z.areas.includes(saved))) setF((x) => ({ ...x, area: saved }));
  }, [defaults.area, zones]);

  // Only ordinary orders show an arrival time here. Design jobs and custom jobs get theirs when the proof is approved.
  // With several products the order arrives with its slowest one, so each is asked and the latest wins.
  useEffect(() => {
    if (custom || designAny) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const rs: (PublicQuote | null)[] = await Promise.all(lines.map((l) => fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...l.quote, area: f.area || null, pickup: f.pickup }) }).then((x) => x.json()).catch(() => null)));
      if (mine !== seq.current || rs.some((r) => !r?.ok)) return;
      const ok = rs as PublicQuote[];
      const slowest = ok.reduce((a, b) => (Date.parse(b.arriveBy) > Date.parse(a.arriveBy) ? b : a));
      setQ({ ...slowest, tier: ok.every((r) => r.tier === '24h') ? '24h' : 'standard' });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.area, f.pickup, lines, custom, designAny]);

  useEffect(() => {
    if (!holdExpiresAt) return;
    const tick = () => setHoldLeft(Math.max(0, Date.parse(holdExpiresAt) - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt]);

  async function applyCoupon(raw: string, quiet = false) {
    const code = raw.trim();
    if (!code) { setCouponMsg({ tone: 'bad', text: 'Type your code first.' }); return; }
    setCouponBusy(true);
    setCouponMsg(null);
    const res = await fetch(`/api/orders/${orderId}/coupon`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, phone: f.phone, email: f.email, area: f.area || null, pickup: f.pickup }) });
    const j = await res.json().catch(() => ({}));
    setCouponBusy(false);
    if (res.ok && j.coupon) {
      setCoupon(j.coupon);
      setCouponInput('');
      setCouponOpen(false);
      try { localStorage.removeItem('brandit.coupon'); } catch { /* fine */ }
      return;
    }
    try { if (quiet) localStorage.removeItem('brandit.coupon'); } catch { /* fine */ }
    setCouponOpen(true);
    setCouponMsg({ tone: 'bad', text: quiet ? `We could not use ${code.toUpperCase()}: ${j.error ?? 'it is not valid'}` : (j.error ?? 'We could not check that code. Try again.') });
  }

  // A code saved from a shared link (?code=...) is tried once, quietly, the first time this page opens.
  useEffect(() => {
    if (custom || coupon || autoTried.current) return;
    autoTried.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem('brandit.coupon') ?? 'null');
      if (saved?.code && Date.now() - saved.at < 14 * 86_400_000) void applyCoupon(saved.code, true);
    } catch { /* no saved code */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function removeCoupon() {
    setCoupon(null);
    setCouponMsg(null);
    await fetch(`/api/orders/${orderId}/coupon`, { method: 'DELETE' }).catch(() => {});
  }

  const zone = zones.find((z) => z.areas.includes(f.area));
  const deliveryFee = f.pickup ? 0 : (zone?.feeKobo ?? 0);
  // A code limited to some products takes money off those lines only.
  const couponSubtotal = coupon?.productIds && coupon.productIds.length > 0 ? lines.filter((l) => coupon.productIds!.includes(l.productId)).reduce((a, l) => a + l.priceKobo, 0) : printKobo;
  const discount = coupon ? discountFor(coupon.rule, { subtotalKobo: couponSubtotal, designKobo, deliveryKobo: deliveryFee }) : 0;
  const t = priceOrder({ itemsKobo, deliveryFeeKobo: deliveryFee, pickup: f.pickup, designFeeKobo: designKobo, discountKobo: discount, vatRate, pricesIncludeVat });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const bad = (field: string) => err?.field === field;
  const vatText = tr('Includes VAT of {amount}', { amount: naira(t.vatKobo) });

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const res = await fetch(`/api/orders/${orderId}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, phone: f.phone, email: f.email, company: f.company, taxId: f.taxId, pickup: f.pickup, area: f.area, addressLine: f.address, plainPack: f.plainPack, window: f.window }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.url) { window.location.href = j.url; return; }
    if (j.redirect) { window.location.href = j.redirect; return; }
    if (j.field === 'signin') { document.getElementById('signin')?.scrollIntoView({ behavior: 'smooth' }); }
    if (j.couponRemoved) setCoupon(null);
    setErr({ message: j.error ?? 'Something went wrong. Please try again.', field: j.field });
    setBusy(false);
    if (j.field && j.field !== 'coupon' && j.field !== 'signin') document.getElementById(j.field === 'address' ? 'address' : j.field)?.focus();
  }

  async function makeShareLink() {
    setShareBusy(true); setErr(null);
    const res = await fetch(`/api/orders/${orderId}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, phone: f.phone, email: f.email, company: f.company, taxId: f.taxId, pickup: f.pickup, area: f.area, addressLine: f.address, plainPack: f.plainPack, window: f.window, share: true, note: shareNote }) });
    const j = await res.json().catch(() => ({}));
    setShareBusy(false);
    if (res.ok && j.link) { setShareLink({ url: j.link, total: j.total, code: j.code }); return; }
    if (j.redirect) { window.location.href = j.redirect; return; }
    if (j.couponRemoved) setCoupon(null);
    setErr({ message: j.error ?? 'Something went wrong. Please try again.', field: j.field });
    if (j.field && j.field !== 'coupon' && j.field !== 'signin') document.getElementById(j.field === 'address' ? 'address' : j.field)?.focus();
  }
  async function copyShare() {
    if (!shareLink) return;
    try { await navigator.clipboard.writeText(shareLink.url); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* the link is on screen to copy by hand */ }
  }
  const shareText = shareLink ? `Please pay for my Brandit order ${shareLink.code} (${naira(shareLink.total)}). You can see exactly what it is and pay by card, transfer or USSD here: ${shareLink.url}` : '';

  const mm = holdLeft != null ? `${Math.floor(holdLeft / 60000)}:${String(Math.floor((holdLeft % 60000) / 1000)).padStart(2, '0')}` : null;
  const deliveryText = f.pickup ? tr('Free (pickup)') : zone ? (deliveryFee === 0 ? tr('Free') : naira(deliveryFee)) : tr('Choose your area');

  return (
    <form id="checkout-form" onSubmit={pay} className="mx-auto max-w-[1160px] px-5 pb-28 lg:pb-12 grid gap-8 lg:grid-cols-[1fr_400px] items-start" noValidate>
      <div className="grid gap-6">
        {signIn && <CheckoutSignIn methods={signIn} next={`/checkout/${orderId}`} />}
        {!signIn && (
          <>
        <section className="card p-5 grid gap-4" aria-labelledby="you">
          <h2 id="you" className="text-[22px]">{tr('Who is this for?')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label" htmlFor="name">{tr('Your name')}</label><input id="name" className="field" autoComplete="name" value={f.name} onChange={set('name')} aria-invalid={bad('name')} /></div>
            <div><label className="label" htmlFor="phone">{tr('Mobile number')}</label><input id="phone" className="field" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" value={f.phone} onChange={set('phone')} aria-invalid={bad('phone')} /></div>
          </div>
          <div><label className="label" htmlFor="email">{tr('Email for your receipt')}</label><input id="email" className="field" type="email" autoComplete="email" value={f.email} onChange={set('email')} aria-invalid={bad('email')} /></div>
          <div><label className="label" htmlFor="company">Company name <span className="font-normal">(optional, for a business invoice)</span></label><input id="company" className="field" autoComplete="organization" value={f.company} onChange={set('company')} /></div>
          {f.company.trim() && (
            <>
              <div><label className="label" htmlFor="taxId">Company tax ID (TIN) <span className="font-normal">(optional, printed on your invoice)</span></label><input id="taxId" className="field" inputMode="text" autoComplete="off" maxLength={30} value={f.taxId} onChange={set('taxId')} /></div>
              <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-[#0B1F33]" checked={f.plainPack} onChange={(e) => setF({ ...f, plainPack: e.target.checked })} />
                <span><span className="font-bold">Plain-pack delivery.</span> <span className="text-muted">No Brandit name on the packing slip or on messages sent to the person receiving it.</span></span>
              </label>
            </>
          )}
        </section>

        <section className="card p-5 grid gap-4" aria-labelledby="where">
          <div className="flex items-center justify-between gap-3">
            <h2 id="where" className="text-[22px]">{tr('Where should it go?')}</h2>
            <button type="button" className="choice" aria-pressed={f.pickup} onClick={() => setF({ ...f, pickup: !f.pickup })}>{tr('I will pick it up')}</button>
          </div>
          {!f.pickup && (
            <>
              <div>
                <label className="label" htmlFor="area">{tr('Area in Lagos')}</label>
                <select id="area" className="field" value={f.area} onChange={(e) => { setF({ ...f, area: e.target.value }); localStorage.setItem('brandit.area', e.target.value); }} aria-invalid={bad('area')}>
                  <option value="">{tr('Choose your area')}</option>
                  {zones.map((z) => <optgroup key={z.id} label={z.name}>{z.areas.map((a) => <option key={a}>{a}</option>)}</optgroup>)}
                </select>
                <p className="mt-1 text-[13px] text-muted">{tr('Area not on the list? Choose pickup, or message us and we will arrange a rider.')}</p>
              </div>
              <div><label className="label" htmlFor="address">{tr('Street address and a landmark')}</label><textarea id="address" className="field !py-3 min-h-[88px]" autoComplete="street-address" placeholder="12 Adeola Odeku Street, opposite the pharmacy" value={f.address} onChange={set('address')} aria-invalid={bad('address')} /></div>
              {windowsEnabled && (
                <fieldset className="grid gap-2">
                  <legend className="label">{tr('When suits you?')} <span className="font-normal">{tr('(optional)')}</span></legend>
                  {q?.tier === '24h' ? (
                    <p className="rounded-md2 bg-paper2 px-4 py-3 text-[15px]">{tr('24-hour orders arrive in the afternoon, by 5pm.')}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2" role="radiogroup">
                      <button type="button" role="radio" aria-checked={f.window === ''} className="choice" aria-pressed={f.window === ''} onClick={() => setF({ ...f, window: '' })}>{tr('Any time')}</button>
                      {WINDOWS.map((w) => (
                        <button key={w.key} type="button" role="radio" aria-checked={f.window === w.key} className="choice" aria-pressed={f.window === w.key} onClick={() => setF({ ...f, window: w.key })}>{tr(w.label)}<span className="ml-1 font-normal text-muted">{w.range}</span></button>
                      ))}
                    </div>
                  )}
                  <p className="text-[13px] text-muted">{designAny || custom ? `${tr('We confirm the day when you approve your proof.')} ` : ''}{tr('Your rider plans for this part of the day. Your arrival date does not change.')}</p>
                </fieldset>
              )}
            </>
          )}
          {f.pickup && (
            <Notice tone="neutral">
              {pickupAddress ? <>{tr('Collect it from')} <span className="font-bold">{pickupAddress}</span>. </> : null}
              {tr('We will message you when it is ready, with a code to show when you collect it. Pickup is free.')}
            </Notice>
          )}
        </section>

        {!custom && (
          <section className="card p-5 grid gap-3" aria-labelledby="someone">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 id="someone" className="text-[20px]">{tr('Is someone else paying?')}</h2>
                <p className="text-[14px] text-muted">{tr('Send them a link. They see exactly what this is, pay it, and the order stays yours.')}</p>
              </div>
              {!shareOpen && <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setShareOpen(true)}>{tr('Ask someone to pay')}</button>}
            </div>
            {shareOpen && !shareLink && (
              <div className="grid gap-3">
                <div><label className="label" htmlFor="share-note">{tr('A short note for them')} <span className="font-normal">{tr('(optional)')}</span></label><input id="share-note" className="field" maxLength={200} placeholder={tr('Pastor, this is for Sunday’s programme')} value={shareNote} onChange={(e) => setShareNote(e.target.value)} /></div>
                <button type="button" className="btn-primary self-start" disabled={shareBusy} onClick={makeShareLink}>{shareBusy ? tr('Making your link…') : tr('Make my link')}</button>
                <p className="text-[13px] text-muted">{tr('We check your details and artwork first. The price and delivery time are worked out again when they open it.')}</p>
              </div>
            )}
            {shareLink && (
              <div className="grid gap-3" aria-live="polite">
                <Notice tone="good">{tr('Your link is ready. We will message you the moment it is paid.')}</Notice>
                <input className="field font-mono text-[14px]" readOnly value={shareLink.url} aria-label={tr('Your pay link')} onFocus={(e) => e.currentTarget.select()} />
                <div className="flex flex-wrap gap-3">
                  <a className="btn-primary" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">{tr('Send on WhatsApp')}</a>
                  <button type="button" className="btn-secondary" onClick={copyShare}>{copied ? tr('Copied') : tr('Copy link')}</button>
                </div>
              </div>
            )}
          </section>
        )}

          </>
        )}

        {err && <div id="checkout-error" aria-live="polite"><Notice tone="bad">{err.message}</Notice></div>}
      </div>

      <aside className="lg:sticky lg:top-[84px] card p-6 shadow-press grid gap-4" aria-label="Order summary">
        <ul className="grid gap-3" aria-label={tr('In this order')}>
          {lines.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[17px] font-bold leading-tight">{l.name}</p>
                <p className="text-[15px] text-muted">{l.qtyText}</p>
                {l.choices.length > 0 && <p className="text-[13px] text-muted">{l.choices.join(' · ')}</p>}
                {l.designPath && <p className="text-[13px] text-muted">{l.studioPath ? tr('Brandit Studio makes the artwork. Printing starts when you approve a design.') : tr('A designer makes the artwork')}</p>}
              </div>
              {multi && <p className="shrink-0 text-[16px] font-bold tabular">{naira(l.priceKobo)}</p>}
            </li>
          ))}
        </ul>
        {!custom && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px]">
            <Link href="/basket" className="link font-bold">{multi ? tr('Edit basket') : tr('Change')}</Link>
            <button type="button" className="link font-bold" onClick={() => sheet.open(null, { from: 'basket' })}>{tr('Add another product')}</button>
          </div>
        )}
        <dl className="grid gap-2 text-[16px] tabular">
          <div className="flex justify-between gap-3"><dt>{custom ? tr('Agreed price') : multi ? tr('Print, {n} products', { n: lines.length }) : tr('Print')}</dt><dd>{naira(printKobo)}</dd></div>
          {designKobo > 0 && <div className="flex justify-between"><dt>{tr('Design fee')}</dt><dd>{naira(designKobo)}</dd></div>}
          <div className="flex justify-between gap-3"><dt>{tr('Delivery')}</dt><dd className="text-right">{deliveryText}</dd></div>
          {coupon && discount > 0 && <div className="flex justify-between gap-3 text-good"><dt>{tr('Coupon {code}', { code: coupon.code })}</dt><dd>−{naira(t.discountKobo)}</dd></div>}
          <div className="flex justify-between border-t border-line pt-3 mt-1 items-baseline"><dt className="font-bold">{tr('Total')}</dt><dd className="font-display font-extrabold text-[32px] leading-none">{naira(t.totalKobo)}</dd></div>
        </dl>
        <p className="text-[13px] text-muted text-right">{vatText}</p>

        {!custom && (
          <div className="grid gap-2" aria-label="Coupon code">
            {coupon ? (
              <div className="flex items-center justify-between gap-3 rounded-md2 bg-good-tint px-4 py-3">
                <div className="min-w-0">
                  <p className="font-bold text-good truncate">{tr('{code} applied', { code: coupon.code })}</p>
                  <p className="text-[13px]">{discount > 0 ? coupon.label : `${coupon.label}. It applies when we deliver to you.`}</p>
                </div>
                <button type="button" className="btn-ghost btn-sm shrink-0" onClick={removeCoupon}>{tr('Remove')}</button>
              </div>
            ) : couponOpen ? (
              <div className="grid gap-2">
                <label className="label !mb-0" htmlFor="coupon">{tr('Coupon code')}</label>
                <div className="flex gap-2">
                  <input id="coupon" className="field !min-h-[48px] uppercase font-mono" autoCapitalize="characters" autoComplete="off" value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void applyCoupon(couponInput); } }} placeholder="WELCOME10" />
                  <button type="button" className="btn-secondary btn-sm shrink-0" disabled={couponBusy} onClick={() => applyCoupon(couponInput)}>{couponBusy ? tr('Checking…') : tr('Apply')}</button>
                </div>
              </div>
            ) : (
              <button type="button" className="link text-left min-h-[44px] self-start font-bold" onClick={() => setCouponOpen(true)}>{tr('Have a coupon code?')}</button>
            )}
            {couponMsg && <p role={couponMsg.tone === 'bad' ? 'alert' : 'status'} className={`text-[14px] ${couponMsg.tone === 'bad' ? 'text-bad' : 'text-good'}`}>{couponMsg.text}</p>}
          </div>
        )}

        {custom ? (
          <Notice tone="neutral">
            Custom job {custom.code}. After you pay, we prepare your proof and you approve it before anything prints.
            {custom.days ? <> We deliver {custom.days} working day{custom.days === 1 ? '' : 's'} after you approve it.</> : null}
          </Notice>
        ) : designAny ? (
          <Notice tone="neutral">{tr('We set your arrival time when you approve your proof.')}</Notice>
        ) : q ? (
          <div className={`rounded-md2 px-4 py-3 ${q.tier === '24h' ? 'bg-good-tint' : 'bg-warn-tint'}`}>
            <p className={`text-[13px] font-bold ${q.tier === '24h' ? 'text-good' : 'text-warn'}`}>{q.tier === '24h' ? tr('24-hour printing') : tr('Standard delivery')}</p>
            <p className="font-display font-extrabold text-[20px] leading-tight">{q.arrivalText.replace(/^./, (c) => c.toUpperCase())}</p>
            {mm && holdLeft! > 0 && <p className="text-[13px] text-muted mt-1">{tr('We are holding this time for {time}.', { time: mm })}</p>}
            {holdLeft === 0 && <p className="text-[13px] text-muted mt-1">{tr('If the time has moved, we tell you before we start.')}</p>}
          </div>
        ) : null}
        {signIn ? (
          <a href="#signin" className="btn-primary w-full hidden lg:inline-flex">{tr('Sign in to pay')}</a>
        ) : (
          <button type="submit" className="btn-primary w-full hidden lg:inline-flex" disabled={busy}>{busy ? tr('Taking you to payment…') : tr('Pay {amount}', { amount: naira(t.totalKobo) })}</button>
        )}
        <p className="text-[13px] text-muted text-center">{tr('Pay by card, bank transfer or USSD. Printed wrong? We reprint or refund.')}</p>
      </aside>

      {/* On a phone the total and the Pay button stay in reach while you fill in the form. */}
      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-[560px] items-center gap-3">
          <div className="min-w-0 flex-1"><p className="text-[12px] font-bold text-muted leading-none">{tr('Total')}</p><p className="font-display text-[24px] font-extrabold leading-tight tabular">{naira(t.totalKobo)}</p></div>
          {signIn ? (
            <a href="#signin" className="btn-primary shrink-0 !px-6">{tr('Sign in to pay')}</a>
          ) : (
            <button type="submit" className="btn-primary shrink-0 !px-6" disabled={busy}>{busy ? tr('One moment…') : tr('Pay now')}</button>
          )}
        </div>
      </div>
    </form>
  );
}
