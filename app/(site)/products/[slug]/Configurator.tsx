'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { naira } from '@/lib/money';
import { PriceBlock, PromisePanel, arrivalLine, type QuoteState, type PublicQuote } from '@/components/PromiseCard';
import { Notice } from '@/components/Bits';
import Link from 'next/link';
import { ProductGallery } from '@/components/ProductGallery';
import { extraLabel } from '@/lib/pricing';
import { ScaleViz } from '@/components/ScaleViz';
import { FramePreview } from '@/components/FramePreview';
import { useLang, useT } from '@/components/LangProvider';

type Option = { key: string; label: string; default: string; help?: string; choices: { value: string; label: string; extra_kobo?: number; extra_per?: string }[] };
type Size = { key: string; label: string };
export type ProductDTO = { slug: string; name: string; blurb: string; mode: 'tier' | 'area' | 'size'; options: Option[]; sizes: Size[]; allowCustom: boolean; images: { id: string; alt: string }[] };
type Zone = { id: string; name: string; areas: string[] };

const FLEX_PRESETS: [number, number][] = [[3, 2], [5, 3], [7, 3], [10, 5]];

export function Configurator({ product, quantities, zones, whatsapp, defaultArea }: { product: ProductDTO; quantities: number[]; zones: Zone[]; whatsapp: string | null; defaultArea?: string | null }) {
  const router = useRouter();
  const tr = useT();
  const pcm = useLang() === 'pcm';
  const defaultQty = product.mode === 'tier' ? (quantities.includes(100) ? 100 : quantities[0] ?? 1) : 1;
  const [quantity, setQuantity] = useState(defaultQty);
  const [config, setConfig] = useState<Record<string, string>>(() => Object.fromEntries(product.options.map((o) => [o.key, o.default])));
  const [sizeKey, setSizeKey] = useState(product.sizes[0]?.key ?? '');
  const [w, setW] = useState('5');
  const [h, setH] = useState('3');
  const [area, setArea] = useState('');
  const [pickup, setPickup] = useState(false);
  const [deadline, setDeadline] = useState(false);
  const [needBy, setNeedBy] = useState('');
  const [quote, setQuote] = useState<QuoteState>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    // The area: what they last chose, else the one saved on their account.
    const saved = localStorage.getItem('brandit.area');
    if (saved && zones.some((z) => z.areas.includes(saved))) setArea(saved);
    else if (defaultArea && zones.some((z) => z.areas.includes(defaultArea))) setArea(defaultArea);
    // A quote link from a colleague opens with their choices already made.
    const sp = new URLSearchParams(window.location.search);
    const q = Number(sp.get('q'));
    if (q > 0 && (product.mode !== 'tier' || quantities.includes(q))) setQuantity(Math.min(5000, Math.trunc(q)));
    if (product.mode === 'area') { if (Number(sp.get('w')) > 0) setW(sp.get('w')!); if (Number(sp.get('h')) > 0) setH(sp.get('h')!); }
    const sz = sp.get('s'); if (sz && product.sizes.some((x) => x.key === sz)) setSizeKey(sz);
    const a = sp.get('a'); if (a && zones.some((z) => z.areas.includes(a))) setArea(a);
    const picked: Record<string, string> = {};
    for (const o of product.options) { const v = sp.get(`o_${o.key}`); if (v && o.choices.some((c) => c.value === v)) picked[o.key] = v; }
    if (Object.keys(picked).length) setConfig((c) => ({ ...c, ...picked }));
    fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'product_view', slug: product.slug }) }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.slug, zones]);

  const body = useMemo(
    () => ({ slug: product.slug, quantity, config, sizeKey: product.mode === 'size' ? sizeKey : undefined, widthFt: product.mode === 'area' ? Number(w) : undefined, heightFt: product.mode === 'area' ? Number(h) : undefined, area: area || null, pickup, needBy: deadline && needBy ? new Date(needBy).toISOString() : null }),
    [product, quantity, config, sizeKey, w, h, area, pickup, deadline, needBy],
  );

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (mine === seq.current) setQuote(j);
    } catch {
      if (mine === seq.current) setQuote({ ok: false, message: tr('We could not reach the price service. Check your connection.') });
    }
  }, [body]);

  useEffect(() => {
    const t = setTimeout(refresh, 220);
    return () => clearTimeout(t);
  }, [refresh]);

  const ok = quote && quote.ok ? (quote as PublicQuote) : null;
  const ready = !!ok && (pickup || !!area);

  async function go() {
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.id) { setErr(j.error ?? tr('Something went wrong. Please try again.')); setBusy(false); return; }
    try { localStorage.setItem('brandit.draft', JSON.stringify({ id: j.id, at: Date.now() })); } catch { /* fine */ }
    router.push(`/order/${j.id}/artwork`);
  }

  const shareUrl = useMemo(() => {
    if (!origin) return '';
    const p = new URLSearchParams({ q: String(quantity) });
    if (product.mode === 'area') { p.set('w', w); p.set('h', h); }
    if (product.mode === 'size' && sizeKey) p.set('s', sizeKey);
    if (area) p.set('a', area);
    for (const [k, v] of Object.entries(config)) p.set(`o_${k}`, v);
    return `${origin}/products/${product.slug}?${p}`;
  }, [origin, product, quantity, w, h, sizeKey, area, config]);
  const shareText = ok ? `${product.name}: ${naira(ok.priceKobo)}. ${ok.arrivalText.replace(/^./, (c) => c.toUpperCase())}. ${shareUrl}` : shareUrl;
  async function copyLink() {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2200); } catch { /* the WhatsApp link still works */ }
  }

  const waText = encodeURIComponent(`Hi Brandit, I want ${product.name}${ok ? ` (${ok.unitLabel}, ${naira(ok.priceKobo)})` : ''}. Can you help me order?`);

  const Summary = (
    <div className="grid gap-4">
      {ok ? (
        <>
          <PriceBlock q={ok} pickup={pickup} />
          <PromisePanel q={ok} onExpire={refresh} />
        </>
      ) : quote && !quote.ok ? (
        <Notice tone="warn">{quote.message}</Notice>
      ) : (
        <div className="h-[190px] rounded-md2 bg-placeholder animate-pulse" aria-label={tr('Working out your price')} />
      )}
      {!pickup && !area && <p className="text-[14px] text-muted">{tr('Choose your area to see the delivery fee and arrival time.')}</p>}
      {err && <Notice tone="bad">{err}</Notice>}
      <button type="button" className="btn-primary w-full" disabled={!ready || busy} onClick={go}>{busy ? tr('Starting your order…') : tr('Continue to artwork')}</button>
      {whatsapp && <a className="btn-secondary btn-sm w-full" href={`https://wa.me/${whatsapp}?text=${waText}`}>{tr('Ask a person on WhatsApp')}</a>}
      {product.allowCustom && (
        <p className="text-center text-[14px] text-muted">{tr('Need it different?')} <Link className="link font-bold" href={`/custom-order?product=${product.slug}`}>{tr('Ask for a custom price')}</Link></p>
      )}
      {ok && shareUrl && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-3 text-[14px]">
          <span className="text-muted">{tr('Need a yes from someone?')}</span>
          <button type="button" className="link" onClick={copyLink}>{copied ? tr('Link copied') : tr('Copy quote link')}</button>
          <a className="link" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}>{tr('Send on WhatsApp')}</a>
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1160px] px-5 pb-10 grid gap-8 lg:grid-cols-[1fr_400px] items-start">
      <div className="grid gap-6">
        <ProductGallery images={product.images} slug={product.slug} name={product.name} blurb={product.blurb} />

        <section className="card p-5 grid gap-5" aria-labelledby="where">
          <div>
            <h2 id="where" className="text-[22px]">{tr('Where should it go?')}</h2>
            <p className="text-[14px] text-muted mt-1">{tr('Your delivery time depends on your area.')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label htmlFor="area" className="label">{tr('Area in Lagos')}</label>
              <select id="area" className="field" value={area} disabled={pickup} onChange={(e) => { setArea(e.target.value); localStorage.setItem('brandit.area', e.target.value); }}>
                <option value="">{tr('Choose your area')}</option>
                {zones.map((z) => (
                  <optgroup key={z.id} label={z.name}>
                    {z.areas.map((a) => <option key={a} value={a}>{a}</option>)}
                  </optgroup>
                ))}
              </select>
              {!pickup && !area && (
                <p className="mt-1.5 text-[13px] text-muted">
                  Area not on the list? Pick it up yourself, or {whatsapp ? <a className="link" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hi Brandit, can you deliver ${product.name} to my area? It is: `)}`}>tell us where on WhatsApp</a> : 'message us'} and we will arrange a rider.
                </p>
              )}
            </div>
            <button type="button" className="choice" aria-pressed={pickup} onClick={() => setPickup(!pickup)}>{tr('I will pick it up')}</button>
          </div>
        </section>

        <section className="card p-5 grid gap-5" aria-labelledby="what">
          <h2 id="what" className="text-[22px]">{product.mode === 'area' ? tr('How big?') : product.mode === 'size' && product.sizes.length > 1 ? tr('Which size?') : tr('How many?')}</h2>

          {product.mode === 'tier' && (
            <div className="flex flex-wrap gap-2.5" role="group" aria-label={tr('Quantity')}>
              {quantities.map((n) => <button key={n} type="button" className="choice min-w-[84px]" aria-pressed={quantity === n} onClick={() => setQuantity(n)}>{n.toLocaleString('en-US')}</button>)}
            </div>
          )}

          {product.mode === 'area' && (
            <>
              <div className="flex flex-wrap gap-2.5" role="group" aria-label="Common sizes">
                {FLEX_PRESETS.map(([a, b]) => <button key={`${a}x${b}`} type="button" className="choice" aria-pressed={Number(w) === a && Number(h) === b} onClick={() => { setW(String(a)); setH(String(b)); }}>{a} × {b} ft</button>)}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label htmlFor="w" className="label">{tr('Width (feet)')}</label><input id="w" className="field" type="number" inputMode="decimal" min="1" step="0.5" value={w} onChange={(e) => setW(e.target.value)} /></div>
                <div><label htmlFor="h" className="label">{tr('Height (feet)')}</label><input id="h" className="field" type="number" inputMode="decimal" min="1" step="0.5" value={h} onChange={(e) => setH(e.target.value)} /></div>
              </div>
              {ok?.areaSqft != null && <p className="text-[15px] text-muted tabular">Total area {ok.areaSqft} sq ft. Each banner is rounded up to a whole square foot.</p>}
              <ScaleViz w={Number(w)} h={Number(h)} />
            </>
          )}

          {product.mode === 'size' && product.sizes.length > 1 && (
            <div className="flex flex-wrap gap-2.5" role="group" aria-label="Size">
              {product.sizes.map((s) => <button key={s.key} type="button" className="choice" aria-pressed={sizeKey === s.key} onClick={() => setSizeKey(s.key)}>{s.label}</button>)}
            </div>
          )}

          {product.slug === 'picture-frames' && <FramePreview sizeKey={sizeKey} colour={config.frame ?? 'black'} />}

          {product.mode !== 'tier' && (
            <div className="flex items-center gap-3">
              <span className="label !mb-0">{product.mode === 'area' ? tr('How many banners?') : tr('How many?')}</span>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="One fewer" className="choice w-12 !px-0 text-[22px]" onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button>
                <input aria-label="Quantity" className="field !w-20 text-center font-bold" type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.trunc(Number(e.target.value)) || 1))} />
                <button type="button" aria-label="One more" className="choice w-12 !px-0 text-[22px]" onClick={() => setQuantity(Math.min(5000, quantity + 1))}>+</button>
              </div>
            </div>
          )}

          {product.options.map((o) => (
            <div key={o.key}>
              <p className="label">{o.label}</p>
              <div className="flex flex-wrap gap-2.5" role="group" aria-label={o.label}>
                {o.choices.map((c) => {
                  const extra = extraLabel(c, naira);
                  return <button key={c.value} type="button" className="choice" aria-pressed={config[o.key] === c.value} onClick={() => setConfig({ ...config, [o.key]: c.value })}>{c.label}{extra && <span className="ml-1.5 text-[13px] font-normal opacity-80">{extra}</span>}</button>;
                })}
              </div>
              {o.help && <p className="text-[14px] text-muted mt-1.5">{o.help}</p>}
            </div>
          ))}
        </section>

        <section className="card p-5 grid gap-3" aria-labelledby="deadline">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="deadline" className="text-[22px]">{tr('Got a deadline?')}</h2>
              <p className="text-[14px] text-muted mt-1">{tr('Tell us when you need it and we will say whether it can make it.')}</p>
            </div>
            <button type="button" className="choice shrink-0" aria-pressed={deadline} onClick={() => setDeadline(!deadline)}>{deadline ? tr('Yes') : tr('Add a deadline')}</button>
          </div>
          {deadline && (
            <div className="max-w-[320px]">
              <label htmlFor="needby" className="label">{tr('I need it by')}</label>
              <input id="needby" className="field" type="datetime-local" value={needBy} onChange={(e) => setNeedBy(e.target.value)} />
            </div>
          )}
        </section>
      </div>

      <aside className="hidden lg:block lg:sticky lg:top-[84px]" aria-label={tr('Your price and delivery time')}>
        <div className="card p-6 shadow-press">{Summary}</div>
      </aside>

      {/* On phones the price and arrival stay in view while you choose. */}
      <div className="lg:hidden grid gap-4">
        <div className="card p-5">{Summary}</div>
      </div>
      <div className="lg:hidden fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 bg-surface border-t border-line px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display font-extrabold text-[22px] leading-none tabular">{ok ? naira(ok.priceKobo) : '…'}</p>
          <p className="text-[13px] text-muted truncate">{ok ? arrivalLine(ok.arrivalText, pcm) : tr('Working out your price')}</p>
        </div>
        <button type="button" className="btn-primary btn-sm shrink-0" disabled={!ready || busy} onClick={go}>{tr('Continue')}</button>
      </div>
    </div>
  );
}
