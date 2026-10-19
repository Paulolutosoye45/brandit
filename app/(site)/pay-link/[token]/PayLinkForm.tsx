'use client';
import { useState } from 'react';
import { naira } from '@/lib/money';
import { Notice } from '@/components/Bits';

/** The two things we need from the person paying: a name for the receipt and an email for Paystack. */
export function PayLinkForm({ token, totalKobo, who }: { token: string; totalKobo: number; who: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const res = await fetch(`/api/pay-link/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.url) { window.location.href = j.url; return; }
    setErr(j.error ?? 'Something went wrong. Please try again.');
    setBusy(false);
  }

  return (
    <form onSubmit={pay} className="card p-6 shadow-press grid gap-4 md:sticky md:top-[84px]" noValidate aria-label="Pay">
      <div>
        <h2 className="text-[22px]">Who is paying?</h2>
        <p className="text-[14px] text-muted">You do not need an account. {who} gets the order; you get the receipt.</p>
      </div>
      <div><label className="label" htmlFor="payer-name">Your name</label><input id="payer-name" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label className="label" htmlFor="payer-email">Your email, for the receipt</label><input id="payer-email" className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      {err && <div aria-live="polite"><Notice tone="bad">{err}</Notice></div>}
      <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Taking you to payment…' : `Pay ${naira(totalKobo)}`}</button>
      <p className="text-[13px] text-muted text-center">Pay by card, bank transfer or USSD. If it is printed wrong, we reprint or refund.</p>
    </form>
  );
}
