'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RiderView } from '@/lib/rider';

type Active = Extract<RiderView, { state: 'active' }>;
const PING_EVERY_MS = 20_000;

export function RiderApp({ token, view }: { token: string; view: RiderView }) {
  if (view.state === 'waiting') return <Card title={`Order ${view.code}`} body="This parcel has not left the shop yet. Open this link again when dispatch says it is ready." />;
  if (view.state === 'done') return <Card title="Delivered. Thank you!" body={`Order ${view.code} is complete. You can close this page.`} tone="good" />;
  if (view.state !== 'active') return null;
  return <Trip token={token} v={view} />;
}

function Card({ title, body, tone }: { title: string; body: string; tone?: 'good' }) {
  return <div className={`card grid gap-2 p-6 ${tone === 'good' ? 'bg-good-tint' : ''}`}><h1 className="text-[26px] leading-tight">{title}</h1><p className="text-[17px]">{body}</p></div>;
}

function Trip({ token, v }: { token: string; v: Active }) {
  const router = useRouter();
  const [started, setStarted] = useState(v.started);
  const [nearby, setNearby] = useState(v.nearby);
  const [sharing, setSharing] = useState(false);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const watch = useRef<number | null>(null);
  const lastSent = useRef(0);
  const wake = useRef<any>(null);

  const call = useCallback(async (action: string, body?: unknown) => {
    const res = await fetch(`/api/rider/${token}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    return (await res.json().catch(() => ({ ok: false, error: 'No connection. Try again.' }))) as { ok: boolean; error?: string; message?: string };
  }, [token]);

  const stopSharing = useCallback(() => {
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    try { wake.current?.release?.(); } catch { /* ignore */ }
    wake.current = null;
    setSharing(false);
  }, []);

  const startSharing = useCallback(() => {
    if (!('geolocation' in navigator)) { setGeoErr('This phone cannot share its location. You can still finish the delivery below.'); return; }
    setGeoErr(null);
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        const now = Date.now();
        if (now - lastSent.current < PING_EVERY_MS) return;
        lastSent.current = now;
        void call('ping', { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      (e) => {
        setSharing(false);
        setGeoErr(e.code === 1 ? 'Location is switched off for this page. Allow it in your browser settings if you want the customer to see where you are. You can still finish the delivery.' : 'We cannot find your location right now. You can still finish the delivery.');
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    setSharing(true);
    (navigator as any).wakeLock?.request?.('screen').then((w: any) => { wake.current = w; }).catch(() => {});
  }, [call]);

  useEffect(() => () => { if (watch.current != null) navigator.geolocation.clearWatch(watch.current); }, []);
  // If the page was reloaded mid-trip, offer sharing again without a second tap on "start".
  useEffect(() => { if (started && !sharing && watch.current == null && v.started) startSharing(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function start() {
    setBusy('start'); setMsg(null);
    const r = await call('start');
    setBusy(null);
    if (!r.ok) { setMsg({ tone: 'bad', text: r.error ?? 'Could not start.' }); return; }
    setStarted(true);
    startSharing();
  }
  async function close() {
    setBusy('nearby'); setMsg(null);
    const r = await call('nearby');
    setBusy(null);
    if (r.ok) { setNearby(true); setMsg({ tone: 'good', text: r.message ?? 'Done.' }); } else setMsg({ tone: 'bad', text: r.error ?? 'Could not send.' });
  }
  async function finish(e: React.FormEvent) {
    e.preventDefault();
    setBusy('code'); setMsg(null);
    const r = await call('code', { code });
    setBusy(null);
    if (r.ok) { stopSharing(); router.refresh(); return; }
    setMsg({ tone: 'bad', text: r.error ?? 'That code did not work.' });
    setCode('');
  }

  const locked = v.lockedUntil && Date.parse(v.lockedUntil) > Date.now();
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${v.addressLine}, ${v.area}, Lagos`)}`;

  return (
    <>
      <div className="card grid gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div><h1 className="text-[28px] leading-tight">Order {v.code}</h1><p className="text-[17px] text-muted">{v.summary}</p></div>
          {v.window && <span className="pill bg-accent text-ink shrink-0">{v.window}</span>}
        </div>
        <div className="grid gap-1 border-t border-line pt-3 text-[17px]">
          <p className="text-[13px] font-bold text-muted">Deliver to</p>
          <p className="font-bold">{v.customer}</p>
          <p>{v.addressLine}{v.area ? `, ${v.area}` : ''}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <a className="btn-secondary" href={maps} target="_blank" rel="noopener noreferrer">Open in Maps</a>
          {v.phone && <a className="btn-secondary" href={`tel:${v.phone}`}>Call {v.customer}</a>}
        </div>
        {v.plainPack && <p className="rounded-md2 bg-warn-tint px-4 py-3 text-[15px]"><span className="font-bold">Plain pack.</span> Do not mention Brandit to the person receiving it.</p>}
      </div>

      {!started ? (
        <div className="card grid gap-3 p-5">
          <h2 className="text-[20px]">Ready to go?</h2>
          <p className="text-[15px] text-muted">When you start, your phone shares where you are with the customer&apos;s tracking page, only until you deliver. Keep this page open.</p>
          <button className="btn-primary w-full" onClick={start} disabled={busy === 'start'}>{busy === 'start' ? 'Starting…' : 'Start the trip'}</button>
        </div>
      ) : (
        <div className="card grid gap-3 p-5">
          <p className="flex items-center gap-2 text-[15px]"><span className={`inline-block h-3 w-3 rounded-full ${sharing ? 'bg-good' : 'bg-line-control'}`} aria-hidden="true" />{sharing ? 'Sharing your location with the customer. Keep this page open.' : 'Not sharing your location.'}</p>
          {!sharing && <button className="btn-secondary btn-sm self-start" onClick={startSharing}>Share my location</button>}
          {sharing && <button className="btn-ghost btn-sm self-start" onClick={stopSharing}>Stop sharing</button>}
          {geoErr && <p role="alert" className="rounded-md2 bg-warn-tint px-4 py-3 text-[15px]">{geoErr}</p>}
          <button className="btn-secondary w-full" onClick={close} disabled={nearby || busy === 'nearby'}>{nearby ? 'Customer knows you are close' : busy === 'nearby' ? 'Sending…' : 'I am close'}</button>
        </div>
      )}

      <form onSubmit={finish} className="card grid gap-3 p-5">
        <h2 className="text-[20px]">At the door</h2>
        <label className="label !mb-0" htmlFor="rc">Ask the customer for their four-digit code</label>
        <div className="flex gap-3">
          <input id="rc" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} className="field !w-36 text-center text-[26px] font-bold tracking-widest" disabled={!!locked} />
          <button className="btn-primary flex-1" disabled={code.length !== 4 || busy === 'code' || !!locked}>{busy === 'code' ? 'Checking…' : 'Complete delivery'}</button>
        </div>
        <p className="text-[13px] text-muted">The code proves the right person received it. If the customer cannot give it, call dispatch.</p>
      </form>

      {msg && <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`rounded-md2 px-4 py-3 text-[16px] ${msg.tone === 'good' ? 'bg-good-tint' : 'bg-bad-tint'}`}>{msg.text}</p>}
    </>
  );
}
