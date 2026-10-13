'use client';
import { useState } from 'react';
import { Notice } from '@/components/Bits';

/** Starts the payment for the pack of three. The price is decided on the server. */
export function BuyPack({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/studio/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku: 'pack3' }) });
      const j = await res.json().catch(() => ({}));
      if (j.url) { window.location.href = j.url; return; }
      setErr(j.error ?? 'Something went wrong. Try again.');
    } catch { setErr('Check your connection and try again.'); }
    setBusy(false);
  }
  return (
    <div className="grid gap-2">
      <button type="button" className="btn-secondary btn-sm w-fit" onClick={go} disabled={busy}>{busy ? 'One moment…' : label}</button>
      {err && <Notice tone="bad">{err}</Notice>}
    </div>
  );
}
