'use client';
import { useState } from 'react';
import { randomCode } from '@/lib/couponCore';

type P = { id: string; name: string };

export function CouponForm({ products, action }: { products: P[]; action: (fd: FormData) => void }) {
  const [kind, setKind] = useState<'percent' | 'fixed' | 'free_delivery'>('percent');
  const [code, setCode] = useState('');
  const KINDS = [
    { v: 'percent', t: 'Percent off', d: 'For example 10% off the print price' },
    { v: 'fixed', t: 'Naira off', d: 'For example ₦1,000 off' },
    { v: 'free_delivery', t: 'Free delivery', d: 'Takes the delivery fee off' },
  ] as const;
  return (
    <form action={action} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="cp-code">Code</label>
          <div className="flex gap-2">
            <input id="cp-code" name="code" className="field uppercase font-mono" value={code} maxLength={24} placeholder="WELCOME10" autoCapitalize="characters" autoComplete="off" onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setCode(randomCode('BRAND'))}>Make one</button>
          </div>
          <p className="mt-1 text-[13px] text-muted">Short and easy to type on a phone. Leave it empty and we make one.</p>
        </div>
        <div><label className="label" htmlFor="cp-desc">What customers see</label><input id="cp-desc" name="description" className="field" maxLength={80} placeholder="Welcome gift: 10% off your first order" /><p className="mt-1 text-[13px] text-muted">Optional. If empty, we describe the offer for you.</p></div>
      </div>

      <fieldset>
        <legend className="label">What does it give?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map((k) => (
            <label key={k.v} className="flex items-start gap-3 rounded-md2 border-2 border-line p-3 cursor-pointer min-h-[64px] has-[:checked]:border-ink has-[:checked]:bg-paper2">
              <input type="radio" name="kind" value={k.v} checked={kind === k.v} onChange={() => setKind(k.v)} className="mt-1 h-5 w-5 accent-[#0B1F33]" />
              <span><span className="block font-bold">{k.t}</span><span className="block text-[13px] text-muted">{k.d}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      {kind === 'percent' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="cp-pct">Percent off</label><input id="cp-pct" name="percent" inputMode="numeric" className="field" placeholder="10" /></div>
          <div><label className="label" htmlFor="cp-cap">Most it can take off (₦, optional)</label><input id="cp-cap" name="cap" inputMode="numeric" className="field" placeholder="5000" /></div>
        </div>
      )}
      {kind === 'fixed' && <div className="sm:max-w-[300px]"><label className="label" htmlFor="cp-amt">Amount off (₦)</label><input id="cp-amt" name="amount" inputMode="numeric" className="field" placeholder="1000" /></div>}

      <div className="grid gap-4 sm:grid-cols-3">
        <div><label className="label" htmlFor="cp-min">Smallest print price (₦, optional)</label><input id="cp-min" name="min_spend" inputMode="numeric" className="field" placeholder="10000" /></div>
        <div><label className="label" htmlFor="cp-start">First day (optional)</label><input id="cp-start" name="starts_on" type="date" className="field" /></div>
        <div><label className="label" htmlFor="cp-end">Last day (optional)</label><input id="cp-end" name="ends_on" type="date" className="field" /></div>
        <div><label className="label" htmlFor="cp-max">Total uses (optional)</label><input id="cp-max" name="max_redemptions" inputMode="numeric" className="field" placeholder="100" /></div>
        <div><label className="label" htmlFor="cp-per">Uses per customer</label><input id="cp-per" name="per_customer" inputMode="numeric" className="field" defaultValue="1" /></div>
        <label className="flex items-center gap-3 min-h-[48px] sm:mt-6"><input type="checkbox" name="first_order_only" className="h-5 w-5 accent-[#0B1F33]" />First order only</label>
      </div>

      {products.length > 0 && (
        <fieldset>
          <legend className="label">Only for these products (leave all unticked for every product)</legend>
          <div className="flex flex-wrap gap-2">
            {products.map((p) => (
              <label key={p.id} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border-2 border-line px-4 cursor-pointer has-[:checked]:border-ink has-[:checked]:bg-paper2">
                <input type="checkbox" name="product" value={p.id} className="h-4 w-4 accent-[#0B1F33]" />{p.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <button className="btn-primary self-start">Create coupon</button>
    </form>
  );
}
