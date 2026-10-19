'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { naira } from '@/lib/money';
import { PriceBlock, PromisePanel, arrivalLine, type QuoteState, type PublicQuote } from '@/components/PromiseCard';
import { Check, Notice } from '@/components/Bits';
import { CropMarks } from '@/components/Brand';
import { ProductGallery } from '@/components/ProductGallery';
import { ScaleViz } from '@/components/ScaleViz';
import { FramePreview } from '@/components/FramePreview';
import { useLang, useT } from '@/components/LangProvider';
import { choiceStatus, formatSplit, kindOf, parseSplit, resolveSelection, MAX_PIECES, type ChoiceStatus } from '@/lib/options';
import type { OptionChoice, ProductOption } from '@/lib/types';
import type { Availability, LadderStep, PackagePrice } from '@/lib/priceEngine';
import type { BuilderData, ExistingLine } from './types';
import { announceBasket } from './basketBus';
import { BleedFix } from '@/components/BleedFix';

/*
 * The Order Builder: the one place a customer chooses what they want, gives their artwork and moves on to pay.
 * It runs as a full page (the product page) and as a panel (opened from the home page, the header and the phone bar).
 * The price on screen is a preview. The server works out the real price again every time something is saved.
 */

const FLEX_PRESETS: [number, number][] = [[3, 2], [5, 3], [7, 3], [10, 5]];
const EMPTY: Record<string, ChoiceStatus> = {};
const UUID = /^[0-9a-f-]{36}$/;

type FileCheck = NonNullable<ExistingLine['check']>;
type Art = {
  path: 'upload' | 'design' | 'studio' | null;
  /** For a Studio line: the design it is linked to and the tier chosen. */
  studio: ExistingLine['studio'];
  fileId: string | null;
  /** Our copy with the extra edge is on the line: the file the customer uploaded. */
  beforeId?: string | null;
  /** The file passed its check and is on the line. A file that is too small is shown but never attached. */
  attached: boolean;
  name: string | null;
  pdf: boolean;
  check: FileCheck | null;
  previewUrl: string | null;
  approved: boolean;
  suggestion: { key: string; label: string } | null;
};
type Line = { orderId: string; itemId: string };

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* fine */ } };

function artFrom(e: ExistingLine | null): Art {
  if (!e) return { path: null, studio: null, fileId: null, attached: false, name: null, pdf: false, check: null, previewUrl: null, approved: false, suggestion: null };
  return {
    path: e.artworkPath, studio: e.studio, fileId: e.artworkFileId, beforeId: e.artworkOriginalFileId, attached: !!e.artworkFileId, name: e.artworkName, pdf: e.artworkPdf, check: e.check,
    previewUrl: e.artworkFileId ? `/api/files/${e.artworkFileId}?o=${e.orderId}` : null, approved: e.approved, suggestion: null,
  };
}

type Props = {
  data: BuilderData;
  mode: 'page' | 'panel';
  /** Panel only: the customer added this product and wants another. */
  onAnother?: () => void;
  startedFrom?: 'home' | 'product' | 'link' | 'panel' | 'reorder' | 'basket';
  /** A starting package from a short link such as /order/business-cards?package=standard. */
  startPackage?: string | null;
  startQty?: number | null;
};

export function OrderBuilder({ data, mode, onAnother, startedFrom = mode === 'panel' ? 'panel' : 'product', startPackage = null, startQty = null }: Props) {
  const { product, quantities, zones, whatsapp, defaultArea, artwork } = data;
  const existing = data.existing;
  const router = useRouter();
  const tr = useT();
  const pcm = useLang() === 'pcm';
  const preview = product.preview;
  const panel = mode === 'panel';

  const defaultQty = product.mode === 'tier' ? (quantities.includes(100) ? 100 : quantities[0] ?? 1) : 1;
  const [quantity, setQuantity] = useState(existing?.quantity ?? startQty ?? defaultQty);
  const [qtyText, setQtyText] = useState('');
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const base = Object.fromEntries(product.options.map((o) => [o.key, o.default]));
    const pkg = startPackage ? product.packages.find((g) => g.key === startPackage) : null;
    return { ...base, ...(existing?.config ?? {}), ...(!existing && pkg ? pkg.set : {}) };
  });
  const [sizeKey, setSizeKey] = useState(existing?.sizeKey ?? product.sizes[0]?.key ?? '');
  const [w, setW] = useState(existing?.widthFt ? String(existing.widthFt) : '5');
  const [h, setH] = useState(existing?.heightFt ? String(existing.heightFt) : '3');
  const [area, setArea] = useState(existing?.area ?? '');
  const [pickup, setPickup] = useState(existing?.pickup ?? false);
  const [deadline, setDeadline] = useState(false);
  const [needBy, setNeedBy] = useState('');
  const [quote, setQuote] = useState<QuoteState>(null);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [ladder, setLadder] = useState<LadderStep[]>([]);
  const [packages, setPackages] = useState<PackagePrice[]>([]);
  const [hint, setHint] = useState<{ key: string; text: string } | null>(null);
  const [busy, setBusy] = useState<null | 'approve' | 'add' | 'brief' | 'fix' | 'go' | 'studio' | 'leave'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  const [others, setOthers] = useState(0);
  const seq = useRef(0);

  // ---------- the line in the basket ----------
  const [line, setLine] = useState<Line | null>(existing ? { orderId: existing.orderId, itemId: existing.itemId } : null);
  const lineRef = useRef<Line | null>(line);
  const creating = useRef<Promise<Line | null> | null>(null);

  // ---------- artwork ----------
  const [art, setArt] = useState<Art>(() => artFrom(existing));
  const [pct, setPct] = useState<number | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const artRef = useRef<HTMLElement>(null);
  const [brief, setBrief] = useState({ purpose: '', wording: '', colours: '', examples: '', logo_note: '' });
  const [refIds, setRefIds] = useState<string[]>([]);
  const [refName, setRefName] = useState<string | null>(null);
  const [useKit, setUseKit] = useState(true);
  const [moreBrief, setMoreBrief] = useState(false);

  // What the choices mean, worked out here for instant feedback. The server works out the same thing again and decides the price.
  const sel = useMemo(
    () => resolveSelection(product.options, { config, sizeKey: product.mode === 'size' ? sizeKey : null, quantity }, { preview }),
    [product.options, product.mode, config, sizeKey, quantity, preview],
  );
  const qty = sel.quantity ?? quantity;
  const localStatus = useMemo(
    () => choiceStatus(product.options, sel, { config, sizeKey: product.mode === 'size' ? sizeKey : null, quantity }, { preview }, naira),
    [product.options, product.mode, sel, config, sizeKey, quantity, preview],
  );

  useEffect(() => {
    setOrigin(window.location.origin);
    if (!existing?.area) {
      const saved = lsGet('brandit.area');
      if (saved && zones.some((z) => z.areas.includes(saved))) setArea(saved);
      else if (defaultArea && zones.some((z) => z.areas.includes(defaultArea))) setArea(defaultArea);
    }
    // A quote link from a colleague opens with their choices already made.
    if (!panel && !existing) {
      const sp = new URLSearchParams(window.location.search);
      const q = Math.trunc(Number(sp.get('q')));
      if (q > 0) setQuantity(Math.min(MAX_PIECES, q));
      if (product.mode === 'area') { if (Number(sp.get('w')) > 0) setW(sp.get('w')!); if (Number(sp.get('h')) > 0) setH(sp.get('h')!); }
      const sz = sp.get('s'); if (sz && product.sizes.some((x) => x.key === sz)) setSizeKey(sz);
      const a = sp.get('a'); if (a && zones.some((z) => z.areas.includes(a))) setArea(a);
      const picked: Record<string, string> = {};
      for (const o of product.options) {
        const v = sp.get(`o_${o.key}`);
        if (!v) continue;
        if (kindOf(o) === 'pick' ? o.choices.some((c) => c.value === v) : true) picked[o.key] = v;
      }
      if (Object.keys(picked).length) setConfig((c) => ({ ...c, ...picked }));
    }
    if (!preview) fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'product_view', slug: product.slug }) }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.slug, zones]);

  const body = useMemo(() => {
    let nb: string | null = null;
    if (deadline && needBy) { const d = new Date(needBy); if (!Number.isNaN(d.getTime())) nb = d.toISOString(); }
    return { slug: product.slug, quantity: qty, config, sizeKey: product.mode === 'size' ? sizeKey : undefined, widthFt: product.mode === 'area' ? Number(w) : undefined, heightFt: product.mode === 'area' ? Number(h) : undefined, area: area || null, pickup, needBy: nb };
  }, [product, qty, config, sizeKey, w, h, area, pickup, deadline, needBy]);
  const bodyRef = useRef(body);
  bodyRef.current = body;

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, detail: true, preview }) });
      const j = await res.json();
      if (mine !== seq.current) return;
      setQuote(j);
      if (j.availability) setAvail(j.availability as Availability);
      if (j.ladder) setLadder(j.ladder as LadderStep[]);
      if (j.packages) setPackages(j.packages as PackagePrice[]);
      // The choices made now have no price at this quantity: move to the nearest quantity that does.
      const steps: number[] = j.availability?.quantities ?? [];
      if (product.mode === 'tier' && steps.length && sel.quantity === null && !steps.includes(body.quantity)) {
        const custom = product.qty.custom && steps.length >= 2;
        if (!(custom && body.quantity >= steps[0] && j.ok)) {
          const next = steps.find((s) => s >= body.quantity) ?? steps[steps.length - 1];
          if (next !== body.quantity) { setQuantity(next); setQtyText(''); }
        }
      }
    } catch {
      if (mine === seq.current) setQuote({ ok: false, message: tr('We could not reach the price service. Check your connection.') });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, preview]);

  useEffect(() => {
    const t = setTimeout(refresh, 220);
    return () => clearTimeout(t);
  }, [refresh]);

  const ok = quote && quote.ok ? (quote as PublicQuote) : null;
  const okRef = useRef(false);
  okRef.current = !!ok;

  // ---------- keeping the saved line in step with the choices ----------
  const syncKey = useMemo(() => JSON.stringify([qty, config, product.mode === 'size' ? sizeKey : null, product.mode === 'area' ? [w, h] : null, area || null, pickup]), [qty, config, sizeKey, w, h, area, pickup, product.mode]);
  const keyRef = useRef(syncKey);
  keyRef.current = syncKey;
  const lastSynced = useRef<string | null>(existing ? JSON.stringify([existing.quantity, { ...Object.fromEntries(product.options.map((o) => [o.key, o.default])), ...existing.config }, product.mode === 'size' ? existing.sizeKey ?? product.sizes[0]?.key ?? '' : null, product.mode === 'area' ? [existing.widthFt ? String(existing.widthFt) : '5', existing.heightFt ? String(existing.heightFt) : '3'] : null, existing.area || null, existing.pickup]) : null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const pushNow = useCallback((): Promise<void> => {
    chain.current = chain.current.then(async () => {
      const l = lineRef.current;
      const key = keyRef.current;
      if (!l || key === lastSynced.current) return;
      const b = bodyRef.current;
      try {
        const res = await fetch(`/api/basket/lines/${l.itemId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: b.quantity, config: b.config, sizeKey: b.sizeKey, widthFt: b.widthFt, heightFt: b.heightFt, area: b.area, pickup: b.pickup }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { setSyncErr(j.error ?? tr('Something went wrong. Please try again.')); return; }
        lastSynced.current = key;
        setSyncErr(null);
        if (typeof j.view?.count === 'number') { announceBasket(j.view.count); setOthers(Math.max(0, j.view.count - 1)); }
        if (j.reset) {
          // The size changed, so the file was looked at again at the new size and the customer must say it still looks right.
          const stop = j.check?.status === 'stop';
          setArt((a) => ({ ...a, approved: false, check: j.check ?? a.check, attached: stop ? false : a.attached }));
          if (stop) setFileErr(tr('Your file is too small for this size. Upload a larger one, or let us fix it.'));
        }
      } catch {
        setSyncErr(tr('We could not save that. Check your connection.'));
      }
    });
    return chain.current;
  }, [tr]);

  useEffect(() => {
    if (!line) return;
    const t = setTimeout(() => { if (okRef.current) void pushNow(); }, 450);
    return () => clearTimeout(t);
  }, [syncKey, line, ok, pushNow]);

  /** Wait until what is saved matches what is on screen. */
  async function flush(): Promise<boolean> {
    if (!lineRef.current) return true;
    await pushNow();
    await chain.current;
    return keyRef.current === lastSynced.current;
  }

  async function ensureLine(): Promise<Line | null> {
    if (lineRef.current) return lineRef.current;
    if (creating.current) return creating.current;
    const p = (async () => {
      try {
        const res = await fetch('/api/basket/lines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...bodyRef.current, startedFrom }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.orderId || !UUID.test(j.itemId ?? '')) { setErr(j.error ?? tr('Something went wrong. Please try again.')); return null; }
        const l = { orderId: j.orderId as string, itemId: j.itemId as string };
        lineRef.current = l;
        lastSynced.current = keyRef.current;
        setLine(l);
        if (typeof j.view?.count === 'number') { announceBasket(j.view.count); setOthers(Math.max(0, j.view.count - 1)); }
        lsSet('brandit.draft', JSON.stringify({ id: j.orderId, at: Date.now() }));
        return l;
      } catch {
        setErr(tr('We could not reach Brandit. Check your connection and try again.'));
        return null;
      } finally { creating.current = null; }
    })();
    creating.current = p;
    return p;
  }

  // ---------- choices ----------
  const choose = (o: ProductOption, value: string) => { setHint(null); setConfig((c) => ({ ...c, [o.key]: value })); };
  const toggle = (o: ProductOption, value: string) => {
    setHint(null);
    setConfig((c) => {
      const now = new Set((c[o.key] ?? '').split(',').filter(Boolean));
      if (now.has(value)) now.delete(value); else now.add(value);
      return { ...c, [o.key]: o.choices.map((x) => x.value).filter((v) => now.has(v)).join(',') };
    });
  };
  const statusOf = (o: ProductOption, c: OptionChoice): ChoiceStatus => (avail?.choices[o.key]?.[c.value] ?? (localStatus[o.key] ?? EMPTY)[c.value] ?? { ok: true, why: null, hide: false, price: '' });
  const tag = (c: OptionChoice) => (!preview ? '' : c.unpriced ? ' (needs a price)' : c.hidden ? ' (switched off)' : c.provisional ? ' (placeholder price)' : '');
  const blocked = (o: ProductOption, st: ChoiceStatus) => setHint({ key: o.key, text: st.why ?? tr('That is not available with your other choices.') });

  const renderOption = (o: ProductOption) => {
    const kind = kindOf(o);
    const choices = o.choices.filter((c) => !statusOf(o, c).hide);
    if (choices.length === 0) return null;
    if (kind === 'pick' && choices.length < 2 && !preview) {
      // One thing to choose from is not a choice: say what it is instead of asking.
      const only = choices[0];
      return <p key={o.key} className="text-[15px] text-muted"><span className="font-bold text-ink">{o.label}:</span> {only.label}{only.note ? `. ${only.note}` : ''}</p>;
    }
    const anyPriced = choices.some((c) => statusOf(o, c).price);
    const current = sel.config[o.key] ?? '';
    const picked = (c: OptionChoice) => (kind === 'tick' ? current.split(',').includes(c.value) : current === c.value);
    const effectiveChoice = kind === 'pick' && current === 'auto' ? o.choices.find((c) => c.value === sel.effective[o.key]) : null;
    const note = kind === 'split' ? null : choices.find((c) => picked(c) && c.note)?.note;
    return (
      <div key={o.key}>
        <p className="label">{o.label}{kind === 'tick' && <span className="ml-1.5 font-normal"> {tr('(pick any)')}</span>}</p>
        {kind === 'split' ? (
          <SplitInput o={o} choices={choices} value={current} onChange={(v) => { setHint(null); setConfig((c) => ({ ...c, [o.key]: v })); }} price={(c) => statusOf(o, c).price} tag={tag} />
        ) : (
          <div className="flex flex-wrap gap-2.5" role="group" aria-label={o.label}>
            {choices.map((c) => {
              const st = statusOf(o, c);
              const price = st.price || (kind === 'pick' && anyPriced && !c.price_like && c.value !== 'auto' ? tr('Included') : '');
              return (
                <button
                  key={c.value}
                  type="button"
                  className="choice flex-col !items-start gap-0 !py-2 text-left sm:flex-row sm:!items-center sm:gap-1.5"
                  aria-pressed={picked(c)}
                  aria-disabled={!st.ok || undefined}
                  title={st.why ?? undefined}
                  onClick={() => (st.ok ? (kind === 'tick' ? toggle(o, c.value) : choose(o, c.value)) : blocked(o, st))}
                >
                  <span className="inline-flex items-center">
                    {c.swatch && <span aria-hidden className="mr-2 inline-block h-4 w-4 shrink-0 rounded-full border border-line-control" style={{ background: c.swatch }} />}
                    {c.label}{tag(c)}
                  </span>
                  {price && <span className={`text-[13px] font-normal ${price === tr('Included') ? 'opacity-70' : 'opacity-90'} tabular`}>{price}</span>}
                </button>
              );
            })}
          </div>
        )}
        {effectiveChoice && <p className="mt-1.5 text-[14px] text-muted">{tr('We picked {name} for your quantity.', { name: effectiveChoice.label })}</p>}
        {hint?.key === o.key && <p role="status" className="mt-1.5 text-[14px] font-bold text-warn">{hint.text}</p>}
        {note && <p className="mt-1.5 text-[14px] text-muted">{note}</p>}
        {o.help && <p className="mt-1.5 text-[14px] text-muted">{o.help}</p>}
      </div>
    );
  };

  const mainOptions = sel.active.filter((o) => o.group !== 'special');
  const specialOptions = sel.active.filter((o) => o.group === 'special');
  const specialOn = specialOptions.filter((o) => (sel.config[o.key] ?? '') !== '' && (sel.config[o.key] ?? '') !== o.default).length;

  // ---------- quantity ----------
  const steps = avail?.quantities?.length ? avail.quantities : quantities;
  const customOk = product.mode === 'tier' && product.qty.custom && steps.length >= 2 && sel.quantity === null;
  const minQty = Math.max(product.qty.min ?? 1, steps[0] ?? 1);
  const maxQty = Math.min(product.qty.max ?? MAX_PIECES, MAX_PIECES);
  const ladderRows = ladder.length ? ladder : steps.map((q) => ({ quantity: q, totalKobo: 0, unitKobo: 0, savePct: null as number | null }));
  const showPrices = ladder.length > 0;
  const packOnly = product.mode === 'tier' && steps.length === 1 && sel.quantity === null;

  // ---------- artwork actions ----------
  function send(l: Line, file: File, asReference = false) {
    return new Promise<any>((resolve) => {
      const fd = new FormData();
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/orders/${l.orderId}/upload?item=${l.itemId}${asReference ? '&as=reference' : ''}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { resolve({ ok: false, error: xhr.status === 413 ? `This file is larger than ${artwork.maxUploadMb} MB. Export a smaller copy and upload that.` : 'Something went wrong. Please try again.' }); }
      };
      xhr.onerror = () => resolve({ ok: false, error: 'The upload was interrupted. Check your connection and try again.' });
      xhr.send(fd);
    });
  }

  function takeOutcome(r: any, name: string, url: string | null, pdf: boolean) {
    if (!r?.ok) { setFileErr(r?.error ?? tr('Something went wrong. Please try again.')); return; }
    setArt({ path: 'upload', studio: null, fileId: r.fileId || null, attached: !!r.attached, name, pdf, check: r.check, previewUrl: url, approved: false, suggestion: r.suggestion ?? null });
    // Bring the file check and the preview into view, so "Looks right" is said while looking at the file.
    setTimeout(() => artRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  async function onFile(file: File | undefined) {
    if (!file || preview) return;
    setErr(null); setFileErr(null); setPct(0);
    if (art.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(art.previewUrl);
    if (file.size > artwork.maxUploadMb * 1_000_000) { setPct(null); setFileErr(`This file is larger than ${artwork.maxUploadMb} MB. Export a smaller copy and upload that.`); return; }
    const l = await ensureLine();
    if (!l) { setPct(null); return; }
    // The file is checked at the size on the line, so the line must be up to date first.
    if (!(await flush())) { setPct(null); return; }
    const r = await send(l, file);
    setPct(null);
    takeOutcome(r, file.name, URL.createObjectURL(file), file.type === 'application/pdf');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function fromKit(a: { id: string; title: string; pdf: boolean }) {
    if (preview) return;
    setErr(null); setFileErr(null); setPct(0);
    const l = await ensureLine();
    if (!l) { setPct(null); return; }
    if (!(await flush())) { setPct(null); return; }
    const res = await fetch(`/api/orders/${l.orderId}/kit-asset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: a.id, itemId: l.itemId }) });
    const r = await res.json().catch(() => ({ ok: false, error: 'Something went wrong. Please try again.' }));
    setPct(null);
    takeOutcome(r, a.title, `/api/brand-assets/${a.id}`, a.pdf);
  }

  async function onReference(file: File | undefined) {
    if (!file || preview) return;
    setPct(0);
    const l = await ensureLine();
    if (!l) { setPct(null); return; }
    const r = await send(l, file, true);
    setPct(null);
    if (r.ok) { setRefIds((x) => [...x, r.fileId]); setRefName(file.name); } else setFileErr(r.error);
  }

  /** "Looks right": the customer says this is what will print. Returns where to go next. */
  async function approve(): Promise<string | null> {
    const l = await ensureLine();
    if (!l) return null;
    if (!(await flush())) return null;
    const res = await fetch(`/api/orders/${l.orderId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: l.itemId }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error ?? tr('Something went wrong. Please try again.')); return null; }
    setArt((a) => ({ ...a, approved: true }));
    return j.next as string;
  }

  async function sendBrief(fix: boolean): Promise<string | null> {
    const l = await ensureLine();
    if (!l) return null;
    if (!(await flush())) return null;
    const payload = fix
      ? { purpose: 'Fix my file', wording: 'Please fix the file I uploaded so it prints sharp. Keep the design as it is.', fix: true, reference_file_ids: art.fileId ? [art.fileId] : [], itemId: l.itemId }
      : { ...brief, reference_file_ids: refIds, use_kit: !!artwork.kit && useKit, itemId: l.itemId };
    const res = await fetch(`/api/orders/${l.orderId}/artwork-path`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error ?? tr('Something went wrong. Please try again.')); return null; }
    setArt((a) => ({ ...a, path: 'design', approved: false }));
    return j.next as string;
  }

  /** Hand over to Brandit Studio: the line is saved first, so the design and the print stay one order. */
  async function goStudio() {
    if (preview || busy) return;
    setErr(null); setBusy('studio');
    const l = await ensureLine();
    if (!l || !(await flush())) { setBusy(null); return; }
    if (!data.signedIn) { router.push(`/signin?next=${encodeURIComponent(`/products/${product.slug}?line=${l.itemId}`)}`); return; }
    if (art.studio?.projectId) { router.push(`/studio/p/${art.studio.projectId}`); return; }
    router.push(`/studio/new?product=${encodeURIComponent(product.slug)}&order=${l.orderId}&item=${l.itemId}`);
  }

  /** Choose another way to give the artwork: a Studio design that was added to the order is taken out of it first. */
  async function leaveStudio(next: 'upload' | 'design' | null) {
    if (art.path === 'studio' && art.studio?.projectId && !preview) {
      setBusy('leave');
      const res = await fetch(`/api/studio/projects/${art.studio.projectId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove_from_order' }) });
      setBusy(null);
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? tr('Something went wrong. Please try again.')); return; }
      await refresh();
    }
    setArt((a) => ({ ...a, path: next, studio: null }));
  }

  async function goNext(kind: 'approve' | 'brief' | 'fix' | 'go') {
    if (preview || busy) return;
    setErr(null); setBusy(kind);
    let next: string | null = null;
    if (kind === 'approve') next = await approve();
    else if (kind === 'brief') next = await sendBrief(false);
    else if (kind === 'fix') next = await sendBrief(true);
    else {
      const l = await ensureLine();
      next = l && (await flush()) ? `/checkout/${l.orderId}` : null;
    }
    if (next) { router.push(next); return; }
    setBusy(null);
  }

  /** Put it in the basket and leave room for another product. */
  async function addAnother() {
    if (preview || busy) return;
    setErr(null); setBusy('add');
    const l = await ensureLine();
    if (!l || !(await flush())) { setBusy(null); return; }
    // A checked file the customer is looking at counts as "looks right" when they carry on to another product.
    if (art.attached && !art.approved && art.check && art.check.status !== 'stop') { if (!(await approve())) { setBusy(null); return; } }
    setBusy(null);
    if (onAnother) onAnother(); else router.push('/products');
  }

  const shareUrl = useMemo(() => {
    if (!origin || preview || panel) return '';
    const p = new URLSearchParams({ q: String(qty) });
    if (product.mode === 'area') { p.set('w', w); p.set('h', h); }
    if (product.mode === 'size' && sizeKey) p.set('s', sizeKey);
    if (area) p.set('a', area);
    for (const [k, v] of Object.entries(config)) p.set(`o_${k}`, v);
    return `${origin}/products/${product.slug}?${p}`;
  }, [origin, product, qty, w, h, sizeKey, area, config, preview, panel]);
  const shareText = ok ? `${product.name}: ${naira(ok.priceKobo)}. ${ok.arrivalText.replace(/^./, (c) => c.toUpperCase())}. ${shareUrl}` : shareUrl;
  async function copyLink() {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2200); } catch { /* the WhatsApp link still works */ }
  }
  const waText = encodeURIComponent(`Hi Brandit, I want ${product.name}${ok ? ` (${ok.unitLabel}, ${naira(ok.priceKobo)})` : ''}. Can you help me order?`);

  // ---------- the one big button ----------
  const status = art.check?.status ?? null;
  const designPath = art.path === 'design';
  const studioPath = art.path === 'studio';
  const briefOk = brief.purpose.trim().length > 0 && brief.wording.trim().length > 0;
  const uploading = pct != null;
  const cta: { label: string; disabled: boolean; onClick: () => void; hint?: string } = (() => {
    if (preview) return { label: tr('Orders are off in preview'), disabled: true, onClick: () => {} };
    if (!ok) return { label: tr('Working out your price…'), disabled: true, onClick: () => {} };
    if (uploading) return { label: pct! < 100 ? tr('Uploading… {pct}%', { pct: pct! }) : tr('Checking your file…'), disabled: true, onClick: () => {} };
    if (syncErr) return { label: tr('Fix the choices above'), disabled: true, onClick: () => {} };
    if (studioPath) return art.studio?.tier
      ? { label: busy === 'go' ? tr('One moment…') : tr('Continue to checkout'), disabled: !!busy, onClick: () => goNext('go') }
      : { label: busy === 'studio' ? tr('One moment…') : art.studio?.projectId ? tr('Continue my Studio design') : tr('Start my Studio design'), disabled: !!busy, onClick: goStudio, hint: tr('Choose Standard or Premium in Studio, then you come back here to pay once for the design and the print.') };
    if (designPath) return { label: busy === 'brief' ? tr('One moment…') : tr('Continue to checkout'), disabled: !briefOk || !!busy, onClick: () => goNext('brief'), hint: briefOk ? undefined : tr('Tell us what it is for and the words to use.') };
    if (art.attached && art.approved) return { label: busy === 'go' ? tr('One moment…') : tr('Continue to checkout'), disabled: !!busy, onClick: () => goNext('go') };
    if (art.attached && status !== 'stop') return { label: busy === 'approve' ? tr('One moment…') : tr('Looks right, continue'), disabled: !!busy, onClick: () => goNext('approve') };
    if (status === 'stop') return { label: tr('Upload a different file'), disabled: !!busy, onClick: () => fileInput.current?.click() };
    return { label: tr('Upload my file'), disabled: !!busy, onClick: () => fileInput.current?.click() };
  })();
  const showConfirm = !preview && art.attached && !art.approved && status !== 'stop' && !designPath && !studioPath;

  // ---------- pieces ----------
  const priceDetails = ok && ok.lines.length > 0 && (
    <details className="rounded-md2 border border-line px-4 py-3">
      <summary className="cursor-pointer text-[15px] font-bold">{tr('What makes up this price')}</summary>
      <ul className="mt-3 grid gap-2 text-[14px]">
        {ok.lines.map((l, i) => (
          <li key={i} className="flex items-start justify-between gap-4">
            <span><span className="font-bold">{l.label}</span>{l.detail && <span className="block text-muted">{l.detail}</span>}</span>
            <span className={`tabular whitespace-nowrap ${l.kobo < 0 ? 'text-good' : ''}`}>{l.kobo < 0 ? '−' : ''}{naira(Math.abs(l.kobo))}</span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-4 border-t border-line pt-2 font-bold"><span>{tr('Your price')}</span><span className="tabular">{naira(ok.priceKobo)}</span></li>
      </ul>
      {ok.basis !== 'step' && ok.fromStep != null && (
        <p className="mt-2 text-[13px] text-muted">
          {ok.basis === 'between'
            ? tr('Worked out from the {n} step: you pay that step\'s price for each piece, and never more than the next step up.', { n: ok.fromStep.toLocaleString('en-US') })
            : tr('Above {n}, each piece costs the same as at {n}.', { n: ok.fromStep.toLocaleString('en-US') })}
        </p>
      )}
      <p className="mt-2 text-[13px] text-muted">{tr('Delivery and any coupon are added at checkout.')}</p>
    </details>
  );

  const PriceCard = (
    <div className="grid gap-4">
      {preview && <Notice tone="warn"><b>{tr('Staff preview.')}</b> {tr('Customers cannot see or order this yet. Choices marked in brackets are not on sale.')}</Notice>}
      {ok ? (
        <>
          <PriceBlock q={ok} pickup={pickup} />
          {others > 0 && !pickup && <p className="-mt-2 text-right text-[13px] text-muted">{tr('Delivery is charged once for everything in your basket.')}</p>}
          {priceDetails}
          <PromisePanel q={ok} onExpire={refresh} />
        </>
      ) : quote && !quote.ok ? (
        <Notice tone="warn">{quote.message}</Notice>
      ) : (
        <div className="h-[190px] rounded-md2 bg-placeholder animate-pulse" aria-label={tr('Working out your price')} />
      )}
      {ok && ok.notes.length > 0 && (
        <Notice tone="neutral"><ul className="grid gap-1">{ok.notes.map((n) => <li key={n}>{n}</li>)}</ul></Notice>
      )}
    </div>
  );

  const Confirm = showConfirm && (
    <p className="text-[13px] leading-snug text-muted">
      <b className="text-ink">{tr('This is what will print.')}</b> {tr('I have checked the spelling, the phone numbers and the colours. We print exactly what you approve.')}
    </p>
  );

  const Actions = (
    <div className="grid gap-3">
      {Confirm}
      {cta.hint && <p className="text-[14px] text-muted">{cta.hint}</p>}
      {(err || syncErr) && <Notice tone="bad">{err ?? syncErr}</Notice>}
      <button type="button" className="btn-primary w-full" disabled={cta.disabled} onClick={cta.onClick}>{cta.label}</button>
      {!preview && ok && (
        <button type="button" className="btn-secondary btn-sm w-full" disabled={!!busy || uploading} onClick={addAnother}>
          {busy === 'add' ? tr('One moment…') : showConfirm ? tr('Looks right, add another product') : tr('Add to basket and choose another product')}
        </button>
      )}
      {whatsapp && !preview && !panel && <a className="btn-secondary btn-sm w-full" href={`https://wa.me/${whatsapp}?text=${waText}`}>{tr('Ask a person on WhatsApp')}</a>}
      {product.allowCustom && !preview && (
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

  const WhereSection = (
    <section className={`${panel ? 'rounded-md2 border border-line p-4' : 'card p-5'} grid gap-4`} aria-labelledby="where">
      <div>
        <h2 id="where" className={panel ? 'text-[18px]' : 'text-[22px]'}>{tr('Where should it go?')}</h2>
        <p className="text-[14px] text-muted mt-1">{tr('Your delivery time depends on your area. You can also set this at checkout.')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label htmlFor="area" className="label">{tr('Area in Lagos')}</label>
          <select id="area" className="field" value={area} disabled={pickup} onChange={(e) => { setArea(e.target.value); if (e.target.value) lsSet('brandit.area', e.target.value); }}>
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
  );

  const PackagesSection = packages.length > 0 && (
    <section className={`${panel ? 'rounded-md2 border border-line p-4' : 'card p-5'} grid gap-4`} aria-labelledby="packages">
      <div>
        <h2 id="packages" className={panel ? 'text-[18px]' : 'text-[22px]'}>{tr('Choose a package')}</h2>
        <p className="text-[14px] text-muted mt-1">{tr('One tap sets everything. You can still change any choice below.')}</p>
      </div>
      <div className={`grid gap-3 ${!panel && packages.length >= 3 ? 'sm:grid-cols-3' : !panel && packages.length === 2 ? 'sm:grid-cols-2' : ''}`} role="group" aria-label={tr('Packages')}>
        {packages.map((p) => {
          const def = product.packages.find((x) => x.key === p.key);
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={p.selected}
              className="relative grid gap-1 rounded-md2 border-2 border-line-control bg-surface p-4 text-left transition-colors hover:border-ink aria-pressed:border-ink aria-pressed:bg-accent/25 aria-pressed:shadow-key"
              onClick={() => { setHint(null); if (def) setConfig((c) => ({ ...c, ...def.set })); }}
            >
              {p.badge && <span className="pill absolute -top-3 right-3 bg-accent text-ink">{p.badge}</span>}
              <span className="text-[18px] font-bold">{p.label}{p.selected && <span className="sr-only"> ({tr('chosen')})</span>}</span>
              {p.tagline && <span className="text-[14px] text-muted">{p.tagline}</span>}
              <span className="mt-1 font-display text-[24px] font-extrabold leading-none tabular">{naira(p.totalKobo)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );

  const WhatSection = (
    <section className={`${panel ? 'rounded-md2 border border-line p-4' : 'card p-5'} grid gap-5`} aria-labelledby="what">
      <h2 id="what" className={panel ? 'text-[18px]' : 'text-[22px]'}>{product.mode === 'area' ? tr('How big?') : product.mode === 'size' && product.sizes.length > 1 ? tr('Which size?') : sel.quantity !== null ? tr('What do you need?') : tr('How many?')}</h2>

      {product.mode === 'tier' && sel.quantity === null && (
        packOnly ? (
          <p className="rounded-md2 bg-paper2 px-4 py-3 text-[16px]">
            {tr('Sold as one pack of {n}.', { n: steps[0].toLocaleString('en-US') })}{' '}
            {showPrices && <b className="tabular">{naira(ladderRows[0].totalKobo)}</b>}
            {product.allowCustom && !preview && <> {tr('Need a different number?')} <Link className="link font-bold" href={`/custom-order?product=${product.slug}`}>{tr('Ask for a custom price')}</Link></>}
          </p>
        ) : (
          <div className="grid gap-2" role="group" aria-label={tr('Quantity')}>
            {ladderRows.map((s) => (
              <button key={s.quantity} type="button" className="choice w-full !justify-between gap-3 !py-2 text-left" aria-pressed={quantity === s.quantity} onClick={() => { setQuantity(s.quantity); setQtyText(''); }}>
                <span className="min-w-[64px] text-[18px] tabular">{s.quantity.toLocaleString('en-US')}</span>
                {showPrices && (
                  <span className="flex flex-1 flex-col items-end gap-0.5 text-right leading-tight">
                    <span className="text-[18px] tabular">{naira(s.totalKobo)}</span>
                    <span className="flex items-center gap-2 text-[13px] font-normal">
                      {s.savePct ? <span className="pill !px-2 !py-0.5 bg-good-tint text-good">{tr('Save {n}%', { n: s.savePct })}</span> : null}
                      <span className="opacity-80 tabular">{tr('{amount} each', { amount: naira(s.unitKobo) })}</span>
                    </span>
                  </span>
                )}
              </button>
            ))}
          </div>
        )
      )}
      {customOk && (
        <div className="grid gap-1.5">
          <label htmlFor="own-qty" className="label !mb-0">{tr('Or type your own number')}</label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              id="own-qty"
              className="field !w-32 text-center font-bold tabular"
              inputMode="numeric"
              placeholder={String(minQty)}
              value={qtyText}
              aria-describedby="own-qty-help"
              onChange={(e) => {
                const t = e.target.value.replace(/\D/g, '').slice(0, 5);
                setQtyText(t);
                const n = Math.trunc(Number(t));
                if (n >= 1) setQuantity(Math.min(n, maxQty));
              }}
              onBlur={() => { const n = Math.trunc(Number(qtyText)); if (qtyText && n < minQty) { setQuantity(minQty); setQtyText(String(minQty)); } }}
            />
            {ok && !steps.includes(qty) && ok.basis !== 'step' && <span className="text-[14px] font-bold tabular">{naira(ok.priceKobo)}</span>}
          </div>
          <p id="own-qty-help" className="text-[13px] text-muted">{tr('From {min} to {max}. A number between two steps costs the same per piece as the step below it, and never more than the next step.', { min: minQty.toLocaleString('en-US'), max: maxQty.toLocaleString('en-US') })}</p>
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

      {product.mode !== 'tier' && sel.quantity === null && (
        <div className="flex items-center gap-3">
          <span className="label !mb-0">{product.mode === 'area' ? tr('How many banners?') : tr('How many?')}</span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="One fewer" className="choice w-12 !px-0 text-[22px]" onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button>
            <input aria-label="Quantity" className="field !w-20 text-center font-bold" type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(MAX_PIECES, Math.trunc(Number(e.target.value)) || 1)))} />
            <button type="button" aria-label="One more" className="choice w-12 !px-0 text-[22px]" onClick={() => setQuantity(Math.min(MAX_PIECES, quantity + 1))}>+</button>
          </div>
        </div>
      )}

      {mainOptions.map(renderOption)}

      {specialOptions.length > 0 && (
        <details className="rounded-md2 border border-line px-4 py-3" open={specialOn > 0}>
          <summary className="cursor-pointer text-[17px] font-bold">{tr('Make it special')} <span className="text-[14px] font-normal text-muted">{specialOn > 0 ? tr('({n} chosen)', { n: specialOn }) : tr('(optional)')}</span></summary>
          <div className="mt-4 grid gap-5">{specialOptions.map(renderOption)}</div>
        </details>
      )}
    </section>
  );

  const DeadlineSection = !panel && (
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
  );

  // ---------- the artwork part ----------
  const ratio = ok?.printW && ok?.printH ? ok.printW / ok.printH : 1.5;
  const portrait = ratio < 1;
  const tone = status === 'pass' ? 'bg-good-tint' : status === 'warn' ? 'bg-warn-tint' : 'bg-bad-tint';

  const ArtSection = (
    <section ref={artRef} className={`${panel ? 'rounded-md2 border border-line p-4' : 'card p-5 scroll-mt-20'} grid gap-4`} aria-labelledby="art">
      <div>
        <h2 id="art" className={panel ? 'text-[18px]' : 'text-[22px]'}>{tr('Your artwork')}</h2>
        <p className="text-[14px] text-muted mt-1">{tr('Upload a file and we check it in seconds, or let a designer make it.')}</p>
      </div>

      <div className={`grid gap-2.5 ${artwork.studioFromKobo != null ? 'sm:grid-cols-3' : 'grid-cols-2'}`} role="group" aria-label={tr('How do you want to give us the artwork?')}>
        <button type="button" aria-pressed={!designPath && !studioPath} disabled={busy === 'leave'} onClick={() => (studioPath ? leaveStudio('upload') : setArt((a) => ({ ...a, path: a.path === 'design' ? null : a.path })))} className={`grid gap-0.5 rounded-md2 border-2 p-3 text-left ${!designPath && !studioPath ? 'border-ink bg-ink text-white' : 'border-line-control hover:border-ink'}`}>
          <span className="text-[16px] font-bold">{tr('I have a file')}</span>
          <span className={`text-[13px] ${!designPath && !studioPath ? 'text-on-ink-muted' : 'text-muted'}`}>{tr('We check it and show what will print.')}</span>
        </button>
        <button type="button" aria-pressed={designPath} disabled={busy === 'leave'} onClick={() => (studioPath ? leaveStudio('design') : setArt((a) => ({ ...a, path: 'design' })))} className={`grid gap-0.5 rounded-md2 border-2 p-3 text-left ${designPath ? 'border-ink bg-ink text-white' : 'border-line-control hover:border-ink'}`}>
          <span className="text-[16px] font-bold">{tr('Design it for me')}</span>
          <span className={`text-[13px] ${designPath ? 'text-on-ink-muted' : 'text-muted'}`}>{tr('{amount} flat fee. A proof in about a working day.', { amount: naira(artwork.designFeeKobo) })}</span>
        </button>
        {artwork.studioFromKobo != null && (
          <button type="button" aria-pressed={studioPath} disabled={!!busy || preview} onClick={() => (studioPath ? undefined : setArt((a) => ({ ...a, path: 'studio' })))} className={`grid gap-0.5 rounded-md2 border-2 p-3 text-left ${studioPath ? 'border-ink bg-ink text-white' : 'border-accent bg-accent/20 hover:border-ink'}`}>
            <span className="text-[16px] font-bold">{tr('Make it with Brandit Studio')}</span>
            <span className={`text-[13px] ${studioPath ? 'text-on-ink-muted' : 'text-muted'}`}>{tr('Free sketches, then from {amount}.', { amount: naira(artwork.studioFromKobo) })}</span>
          </button>
        )}
      </div>

      {studioPath && artwork.studio && (
        <div className="grid gap-3 rounded-md2 bg-paper2 p-4" aria-live="polite">
          {art.studio?.tier ? (
            <>
              <p className="font-bold">{tr('Your Brandit Studio {tier} design is in this order.', { tier: art.studio.tier === 'premium' ? tr('Premium') : tr('Standard') })}</p>
              <p className="text-[14px] text-muted">{tr('{amount} is added to your price for the design. Studio starts after you pay. Printing starts when you approve a design.', { amount: naira(art.studio.feeKobo) })}</p>
              <div className="flex flex-wrap gap-3">
                {art.studio.projectId && <a className="btn-secondary btn-sm" href={`/studio/p/${art.studio.projectId}`}>{tr('Open my design')}</a>}
                <button type="button" className="link text-[14px]" disabled={busy === 'leave'} onClick={() => leaveStudio(null)}>{tr('Take it out')}</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[15px]">{tr('Type your words, see free sketches, then add a design to this order. You pay once, for the design and the print.')}</p>
              <ul className="grid gap-1 text-[14px]">
                {(['standard', 'premium'] as const).map((t) => artwork.studio?.[t] && (
                  <li key={t} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-bold">{t === 'premium' ? tr('Premium design') : tr('Standard design')}</span>
                    <span className="tabular text-muted">{naira(artwork.studio![t]!.priceKobo)}{artwork.studio![t]!.creditKobo > 0 ? ` · ${tr('{amount} off your print', { amount: naira(artwork.studio![t]!.creditKobo) })}` : ''}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {!designPath && !studioPath && (
        <div className="grid gap-4">
          <input ref={fileInput} id={`file-${mode}`} type="file" aria-label="Choose your artwork file" className="sr-only" accept="image/jpeg,image/png,application/pdf" onChange={(e) => onFile(e.target.files?.[0])} />
          {!art.attached && !art.check && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
              className="grid place-items-center gap-2 rounded-md2 border-2 border-dashed border-line-control bg-paper p-5 text-center"
            >
              <button type="button" className="btn-secondary btn-sm" disabled={preview || uploading} onClick={() => fileInput.current?.click()}>{tr('Choose a file')}</button>
              <p className="text-[13px] text-muted">{tr('PDF, JPG or PNG, up to {n} MB. You can also drop it here.', { n: artwork.maxUploadMb })}</p>
            </div>
          )}
          {uploading && (
            <div className="w-full" role="status" aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full bg-ink transition-[width]" style={{ width: `${pct}%` }} /></div>
              <p className="mt-1.5 text-[14px]">{pct! < 100 ? tr('Uploading… {pct}%', { pct: pct! }) : tr('Checking your file…')}</p>
            </div>
          )}

          {artwork.kit && artwork.kit.assets.length > 0 && !art.attached && (
            <div className="grid gap-2 rounded-md2 bg-paper2 p-3">
              <p className="text-[15px] font-bold">{tr('Or use a file from your brand kit')}</p>
              <ul className="flex gap-3 overflow-x-auto pb-1">
                {artwork.kit.assets.map((a) => (
                  <li key={a.id} className="shrink-0">
                    <button type="button" onClick={() => fromKit(a)} className="grid w-[96px] gap-1 text-left" aria-label={`Use ${a.title}`}>
                      <span className="grid h-[76px] w-[96px] place-items-center overflow-hidden rounded-sm2 border border-line bg-white">
                        {a.thumb
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={`/api/brand-assets/${a.id}?size=thumb`} alt="" className="h-full w-full object-contain" />
                          : <span className="px-2 text-center text-[12px] font-bold">PDF</span>}
                      </span>
                      <span className="line-clamp-2 text-[13px] font-bold leading-tight">{a.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {fileErr && <Notice tone="bad">{fileErr}</Notice>}

          {art.check && (
            <div className="grid gap-4">
              <div className={`grid gap-2 rounded-md2 p-4 ${tone}`} role="status">
                <p className="flex items-start gap-2 text-[17px] font-bold">
                  <span className={`mt-0.5 shrink-0 ${status === 'pass' ? 'text-good' : status === 'warn' ? 'text-warn' : 'text-bad'}`}>
                    {status === 'pass' ? <Check className="h-5 w-5" /> : <span aria-hidden className="font-display text-[20px] leading-none">!</span>}
                  </span>
                  {art.check.headline}
                </p>
                <ul className="grid gap-1.5 text-[15px]">
                  {art.check.lines.filter((l) => l.status !== 'pass' || l.id === 'resolution' || l.id === 'shape' || l.id === 'bleed').map((l) => (
                    <li key={l.id}><span className="font-bold">{l.label}: </span>{l.message}</li>
                  ))}
                </ul>
              </div>

              {line && status !== 'stop' && (
                <BleedFix
                  orderId={line.orderId} itemId={line.itemId} lines={art.check.lines} fileId={art.fileId} beforeFileId={art.beforeId ?? null} pdf={art.pdf} disabled={preview || uploading}
                  onResult={(r) => setArt((a) => ({ ...a, fileId: r.fileId, beforeId: r.beforeFileId, check: r.check as FileCheck, previewUrl: `/api/files/${r.fileId}?o=${line.orderId}`, approved: false }))}
                />
              )}

              {art.suggestion && artwork.isFrame && (
                <Notice tone="neutral"><p className="font-bold">Tip for a sharper frame</p><p>This photo will print sharpest at {art.suggestion.label}. Change the size above if you would like.</p></Notice>
              )}

              {status === 'stop' ? (
                <div className="grid gap-3">
                  <p className="text-[15px]">{tr('Upload a larger or clearer file, or let us fix it for you.')}</p>
                  <div className="flex flex-wrap gap-3">
                    <button type="button" className="btn-secondary btn-sm" disabled={uploading} onClick={() => fileInput.current?.click()}>{tr('Upload a different file')}</button>
                    {art.fileId && <button type="button" className="btn-dark btn-sm" disabled={!!busy || preview} onClick={() => goNext('fix')}>{busy === 'fix' ? tr('One moment…') : tr('Fix it for me for {amount}', { amount: naira(artwork.fixFeeKobo) })}</button>}
                  </div>
                </div>
              ) : (
                <>
                  {art.previewUrl && (
                    <figure className="grid justify-items-center gap-2">
                      <div className="relative grid w-full max-w-[420px] place-items-center rounded-md2 bg-paper2 p-5">
                        <CropMarks />
                        {art.pdf ? (
                          <div className="grid h-[200px] place-items-center text-center text-muted"><div><p className="break-all font-bold text-ink">{art.name}</p><p className="text-[14px]">PDF. A person checks the pages before printing.</p></div></div>
                        ) : (
                          <div className="relative overflow-hidden bg-white shadow-[0_6px_0_rgba(11,31,51,0.18)]" style={{ aspectRatio: String(ratio), width: portrait ? '60%' : '100%', maxHeight: 320 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={art.previewUrl} alt={tr('Your artwork as it will print')} className="h-full w-full object-cover" />
                          </div>
                        )}
                      </div>
                      <figcaption className="text-center text-[14px] text-muted">{tr('This is your proof. It shows how your file fits the print area. Anything outside the frame is trimmed.')}</figcaption>
                    </figure>
                  )}
                  <div className="flex flex-wrap items-center gap-3 text-[14px]">
                    {art.approved && <span className="pill bg-good-tint text-good">{tr('You approved this file')}</span>}
                    <button type="button" className="link" disabled={uploading} onClick={() => fileInput.current?.click()}>{tr('Choose a different file')}</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {designPath && (
        <div className="grid gap-4">
          <div><label className="label" htmlFor="b1">{tr('What is it for?')}</label><input id="b1" className="field" placeholder="For example: opening day of my salon" value={brief.purpose} onChange={(e) => setBrief({ ...brief, purpose: e.target.value })} /></div>
          <div><label className="label" htmlFor="b2">{tr('The exact words to use')}</label><textarea id="b2" className="field !py-3 min-h-[100px]" placeholder="Names, phone numbers, address, offers. We copy these exactly." value={brief.wording} onChange={(e) => setBrief({ ...brief, wording: e.target.value })} /></div>
          <div>
            <p className="label">{tr('Your logo')}</p>
            <input id={`logo-${mode}`} type="file" aria-label="Choose a logo or reference picture" className="sr-only" accept="image/jpeg,image/png,application/pdf" onChange={(e) => onReference(e.target.files?.[0])} />
            <div className="flex flex-wrap items-center gap-3"><label htmlFor={`logo-${mode}`} className="btn-secondary btn-sm cursor-pointer">{tr('Upload a logo')}</label><span className="text-[14px] text-muted">{refName ? tr('Added: {name}', { name: refName }) : tr('Or tell us below where to find it.')}</span></div>
          </div>
          <button type="button" className="link self-start text-[14px]" aria-expanded={moreBrief} onClick={() => setMoreBrief(!moreBrief)}>{moreBrief ? tr('Fewer details') : tr('Add colours or an example (optional)')}</button>
          {moreBrief && (
            <>
              <div><label className="label" htmlFor="b4">{tr('Colours you like')}</label><input id="b4" className="field" placeholder="For example: navy and gold" value={brief.colours} onChange={(e) => setBrief({ ...brief, colours: e.target.value })} /></div>
              <div><label className="label" htmlFor="b5">{tr('Anything we should look at?')}</label><input id="b5" className="field" placeholder="A link to a design you like, or where we can find your logo" value={brief.examples} onChange={(e) => setBrief({ ...brief, examples: e.target.value })} /></div>
            </>
          )}
          {artwork.kit && (
            <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md2 bg-paper2 p-3">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-[#0B1F33]" checked={useKit} onChange={(e) => setUseKit(e.target.checked)} />
              <span><span className="block font-bold">{tr('Use my brand kit')}{artwork.kit.name ? ` (${artwork.kit.name})` : ''}</span><span className="block text-[14px] text-muted">{tr('Your logo, colours, fonts and contact line go to the designer, so you do not have to repeat them.')}</span></span>
            </label>
          )}
          <Notice tone="neutral">{tr('Design fee')} <span className="font-bold">{naira(artwork.designFeeKobo)}</span>. {tr('It is added at checkout. Your delivery time is set when you approve the proof, so a 24-hour order runs from that moment.')}</Notice>
        </div>
      )}
    </section>
  );

  // ---------- layouts ----------
  if (panel) {
    const thumb = product.images[0];
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="grid flex-1 content-start gap-4 overflow-y-auto px-4 pb-6 pt-1">
          <div className="flex items-center gap-3">
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/product-images/${thumb.id}?size=thumb`} alt="" className="h-14 w-14 shrink-0 rounded-md2 border border-line object-cover" />
            )}
            <div className="min-w-0">
              <h2 className="text-[22px] leading-tight">{product.name}</h2>
              {product.blurb && <p className="line-clamp-2 text-[14px] text-muted">{product.blurb}</p>}
            </div>
          </div>
          {PackagesSection}
          {WhatSection}
          {WhereSection}
          <div className="rounded-md2 border border-line p-4">{PriceCard}</div>
          {ArtSection}
        </div>
        <div className="border-t border-line bg-surface px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_16px_rgba(11,31,51,0.06)]">
          <div className="mb-2.5 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-[26px] font-extrabold leading-none tabular">{ok ? naira(ok.priceKobo) : '…'}</p>
              <p className="mt-0.5 truncate text-[13px] text-muted">{ok ? arrivalLine(ok.arrivalText, pcm) : tr('Working out your price')}</p>
            </div>
            {!preview && ok && (
              <button type="button" className="link shrink-0 pb-0.5 text-[14px]" disabled={!!busy || uploading} onClick={addAnother}>{busy === 'add' ? tr('One moment…') : showConfirm ? tr('Looks right, add another') : tr('Add another product')}</button>
            )}
          </div>
          {Confirm && <div className="mb-2.5">{Confirm}</div>}
          {cta.hint && <p className="mb-2 text-[13px] text-muted">{cta.hint}</p>}
          {(err || syncErr) && <p role="alert" className="mb-2 text-[14px] font-bold text-bad">{err ?? syncErr}</p>}
          <button type="button" className="btn-primary w-full" disabled={cta.disabled} onClick={cta.onClick}>{cta.label}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1160px] px-5 pb-10 grid gap-8 lg:grid-cols-[1fr_400px] items-start">
      {/* On a phone the file picker and the button live in the sticky bar below, so the input sits outside the sections. */}
      <div className="grid gap-6">
        <ProductGallery images={product.images} slug={product.slug} name={product.name} blurb={product.blurb} />
        {WhereSection}
        {PackagesSection}
        {WhatSection}
        {DeadlineSection}
        {ArtSection}
      </div>

      <aside className="hidden lg:block lg:sticky lg:top-[84px]" aria-label={tr('Your price and delivery time')}>
        <div className="card grid gap-4 p-6 shadow-press">{PriceCard}{Actions}</div>
      </aside>

      {/* On phones the price and arrival stay in view while you choose. */}
      <div className="lg:hidden grid gap-4">
        <div className="card grid gap-4 p-5">{PriceCard}{Actions}</div>
      </div>
      <div className="lg:hidden fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-2.5">
        <div className="min-w-0">
          <p className="font-display font-extrabold text-[22px] leading-none tabular">{ok ? naira(ok.priceKobo) : '…'}</p>
          <p className="truncate text-[13px] text-muted">{ok ? arrivalLine(ok.arrivalText, pcm) : tr('Working out your price')}</p>
        </div>
        <button type="button" className="btn-primary btn-sm shrink-0" disabled={cta.disabled} onClick={cta.onClick}>{cta.label}</button>
      </div>
    </div>
  );
}

/** A count for each choice, such as how many of each T-shirt size. */
function SplitInput({ o, choices, value, onChange, price, tag }: { o: ProductOption; choices: OptionChoice[]; value: string; onChange: (v: string) => void; price: (c: OptionChoice) => string; tag: (c: OptionChoice) => string }) {
  const tr = useT();
  const counts = parseSplit(value);
  const order = o.choices.map((c) => c.value);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const set = (v: string, n: number) => onChange(formatSplit({ ...counts, [v]: Math.max(0, Math.min(MAX_PIECES, n)) }, order));
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {choices.map((c) => {
          const n = counts[c.value] ?? 0;
          const p = price(c);
          return (
            <div key={c.value} className={`flex items-center justify-between gap-2 rounded-md2 border-2 px-3 py-2 ${n > 0 ? 'border-ink bg-accent/20' : 'border-line-control'}`}>
              <label htmlFor={`${o.key}-${c.value}`} className="min-w-0 text-[16px] font-bold leading-tight">
                {c.label}{tag(c)}
                {p && <span className="block text-[13px] font-normal text-muted tabular">{p}</span>}
              </label>
              <div className="flex shrink-0 items-center gap-1.5">
                <button type="button" aria-label={tr('One fewer {name}', { name: c.label })} className="choice w-11 !min-h-[44px] !px-0 text-[20px]" onClick={() => set(c.value, n - 1)} disabled={n === 0}>−</button>
                <input id={`${o.key}-${c.value}`} className="field !min-h-[44px] !w-14 !px-1 text-center font-bold tabular" inputMode="numeric" value={n || ''} placeholder="0" onChange={(e) => set(c.value, Math.trunc(Number(e.target.value.replace(/\D/g, ''))) || 0)} />
                <button type="button" aria-label={tr('One more {name}', { name: c.label })} className="choice w-11 !min-h-[44px] !px-0 text-[20px]" onClick={() => set(c.value, n + 1)}>+</button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[15px] font-bold tabular" aria-live="polite">{total > 0 ? tr('{n} in total', { n: total.toLocaleString('en-US') }) : <span className="text-warn">{tr('Choose how many of each.')}</span>}</p>
    </div>
  );
}
