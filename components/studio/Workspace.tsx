'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectView, VersionView } from '@/lib/studio/view';
import { BriefForm, PhoneVerify, type Draft } from './BriefForm';
import { act, post, naira, Spinner, StatusIcon, Toast, useEvery } from './ui';

type Product = { slug: string; name: string; mode: string; sizes: { key: string; label: string }[] };
type Props = { initial: ProjectView; quantities: number[]; adaptProducts: Product[]; safePct: number; paid: string | null };
type Msg = { tone: 'good' | 'bad' | 'warn' | 'neutral'; text: string } | null;

const PAID_NOTE: Record<string, string> = {
  standard: 'Payment received. Your designs are being made now.', premium: 'Payment received. Your drafts are being made now.', upgrade: 'You are now on Premium. Your extra drafts are being made.',
  round: 'One more round of changes added.', vector: 'Payment received. Your vector file is being made.', check: 'A Brandit designer will check your design before it prints.',
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

function labelOf(vs: VersionView[], v: VersionView): string {
  if (v.kind === 'concept' || v.kind === 'draft') return `${v.label} ${v.idx + 1}`;
  if (v.kind === 'sketch') return `Sketch ${v.idx + 1}`;
  if (v.kind === 'revision' || v.kind === 'edit') return `${v.label}, round ${v.round}`;
  if (v.kind === 'final') return `${v.label} ${v.idx + 1}`;
  if (v.kind === 'adapt') return v.spec?.label ?? v.label;
  const n = vs.filter((x) => x.kind === 'tweak' && x.createdAt <= v.createdAt).length;
  return `${v.label} ${n}`;
}

export function Workspace({ initial, quantities, adaptProducts, safePct, paid }: Props) {
  const router = useRouter();
  const [v, setV] = useState<ProjectView>(initial);
  // The words form starts open for a new design and closed once there is something to look at. Decided once, so it never snaps shut while someone is typing.
  const [formOpenAtStart] = useState(() => !initial.tier && initial.versions.length === 0);
  const [draft, setDraft] = useState<Draft>(initial.brief);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(paid && PAID_NOTE[paid] ? { tone: 'good', text: PAID_NOTE[paid] } : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [guides, setGuides] = useState(false);
  const [spell, setSpell] = useState(false);
  const [qty, setQty] = useState<number>(0);
  const [adaptSlug, setAdaptSlug] = useState('');
  const [adaptSize, setAdaptSize] = useState('');
  const [adaptW, setAdaptW] = useState('4');
  const [adaptH, setAdaptH] = useState('3');
  const picked = useRef(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const startRef = useRef<HTMLElement>(null);

  const approved = v.status === 'approved';
  const locked = approved;
  const vs = v.versions;
  const paidVersions = vs.filter((x) => x.kind !== 'sketch');
  const sketches = vs.filter((x) => x.kind === 'sketch');
  const selected = vs.find((x) => x.id === sel) ?? null;

  // ---- keeping the page current ----
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/studio/projects/${v.id}`, { cache: 'no-store' });
      const j = await res.json().catch(() => null);
      if (j?.ok && j.view) setV(j.view as ProjectView);
    } catch { /* the next poll will try again */ }
  }, [v.id]);
  useEvery(refresh, 3000, v.working);
  useEffect(() => { if (v.working) void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Choose what to look at: what the person picked, else the approved design, else the newest finished one.
  useEffect(() => {
    if (sel && vs.some((x) => x.id === sel)) return;
    picked.current = false;
    const best = vs.find((x) => x.approved) ?? [...paidVersions].reverse().find((x) => x.status === 'ready') ?? [...sketches].reverse().find((x) => x.status === 'ready') ?? null;
    setSel(best?.id ?? null);
  }, [vs, sel, paidVersions, sketches]);
  useEffect(() => {
    if (picked.current) return;
    const newest = [...paidVersions].reverse().find((x) => x.status === 'ready') ?? [...sketches].reverse().find((x) => x.status === 'ready');
    if (newest && !vs.some((x) => x.approved) && newest.id !== sel) setSel(newest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vs.map((x) => x.id + x.status).join()]);
  useEffect(() => { if (!qty) setQty(quantities.includes(v.product.quantity) ? v.product.quantity : (quantities[0] ?? v.product.quantity)); }, [qty, quantities, v.product.quantity]);

  const say = (tone: NonNullable<Msg>['tone'], text: string) => { setMsg({ tone, text }); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setMsg(null); try { await fn(); } finally { setBusy(null); } };

  function pick(id: string) {
    picked.current = true;
    setSel(id);
    const x = vs.find((y) => y.id === id);
    if (x?.brief && !dirty) setDraft({ ...draft, lines: x.brief.lines ?? draft.lines, choices: { ...draft.choices, ...(x.brief.choices ?? {}) }, look: x.brief.look ?? draft.look, palette: x.brief.palette || draft.palette, style: x.brief.style || draft.style });
  }
  const onDraft = (d: Draft) => { setDraft(d); setDirty(true); };

  // ---- actions ----
  async function saveBrief(): Promise<boolean> {
    const r = await act(v.id, { action: 'brief', brief: draft });
    if (!r.ok) { say('bad', r.error ?? 'We could not save.'); return false; }
    setDraft(r.brief); setDirty(false);
    if (r.warnings?.length) setMsg({ tone: 'warn', text: r.warnings.join(' ') });
    await refresh();
    return true;
  }
  const saveOnly = () => run('save', async () => { if (await saveBrief()) say('good', 'Saved.'); });

  async function giveConsent() {
    const r = await act(v.id, { action: 'consent' });
    if (!r.ok) return say('bad', r.error ?? 'Something went wrong.');
    await refresh();
  }

  const sketch = () => run('sketch', async () => {
    if (dirty && !(await saveBrief())) return;
    if (!v.consent) return say('warn', 'Please tick the box under “Your pictures” first.');
    const r = await act(v.id, { action: 'sketch' });
    if (!r.ok) { if (r.code === 'phone') return say('warn', r.error!); return say('bad', r.error!); }
    setMsg({ tone: 'good', text: 'Making your free sketch. It takes about half a minute.' });
    await refresh();
  });

  const buy = (sku: string, versionId?: string) => run(`buy:${sku}`, async () => {
    if (dirty && (sku === 'standard' || sku === 'premium') && !(await saveBrief())) return;
    if ((sku === 'standard' || sku === 'premium') && !v.consent) return say('warn', 'Please tick the box under “Your pictures” first.');
    const r = await post('/api/studio/buy', { sku, projectId: v.id, versionId });
    if (r.url) { window.location.href = r.url; return; }
    say('bad', r.error ?? 'We could not start the payment.');
  });

  // A design started from a line in the basket is bought by adding it to that order: one payment for the design and the print.
  const addToOrder = (tier: 'standard' | 'premium') => run(`add:${tier}`, async () => {
    if (dirty && !(await saveBrief())) return;
    if (!v.consent) return say('warn', 'Please tick the box under “Your pictures” first.');
    const r = await act(v.id, { action: 'add_to_order', tier });
    if (!r.ok) return say('bad', r.error!);
    router.push(r.next ?? '/basket');
  });
  const takeOut = () => simple('remove', { action: 'remove_from_order' }, 'Taken out of your order.');

  const usePack = () => run('pack', async () => {
    if (dirty && !(await saveBrief())) return;
    if (!v.consent) return say('warn', 'Please tick the box under “Your pictures” first.');
    const r = await act(v.id, { action: 'unlock_pack' });
    if (!r.ok) return say('bad', r.error!);
    say('good', 'Unlocked with a pack design. Your designs are being made now.');
    await refresh();
  });

  const apply = () => run('tweak', async () => {
    if (!selected) return;
    const r = await act(v.id, { action: 'tweak', fromVersionId: selected.id, brief: draft });
    if (!r.ok) return say('bad', r.error!);
    setDirty(false); picked.current = false;
    await refresh(); setSel(r.versionId);
    say('good', 'Done. Fixing words is free, so change as many as you like.');
  });

  const change = () => run('change', async () => {
    if (!selected) return;
    const r = await act(v.id, { action: 'change', fromVersionId: selected.id, note });
    if (!r.ok) {
      if (r.code === 'need_round') return say('warn', r.error!);
      return say('bad', r.error!);
    }
    setNote(''); picked.current = false; await refresh();
    say('good', 'Making your changes now.');
  });

  const simple = (key: string, body: Record<string, unknown>, ok: string, after?: (r: any) => void) => run(key, async () => {
    const r = await act(v.id, body);
    if (!r.ok) return say('bad', r.error!);
    await refresh(); after?.(r);
    if (ok) say('good', ok);
  });

  const finish = (id: string) => simple('finish', { action: 'finish', versionId: id }, 'Preparing your print file. This takes about a minute.');
  const approve = () => simple('approve', { action: 'approve', versionId: selected?.id, spellingConfirmed: spell }, '', (r) => say('good', r.review ? 'Approved. A Brandit designer will now check it before you order.' : 'Approved and locked. You can order it now.'));
  const share = (id: string | null) => simple('share', { action: 'share', versionId: id }, id ? 'Anyone with the link can see this design and leave a comment.' : 'Sharing is off.');
  const makeVector = (id: string) => simple('vector', { action: 'vector', versionId: id }, 'Making your vector file. It takes a minute.');
  const premiumFinal = () => simple('final', { action: 'premium_final', fromVersionId: selected?.id }, 'Making your Premium final.', (r) => { picked.current = false; setSel(r.versionId); });

  const adaptSel = adaptProducts.find((p) => p.slug === adaptSlug) ?? null;
  const adapt = () => simple('adapt', { action: 'adapt', fromVersionId: selected?.id, productSlug: adaptSlug, sizeKey: adaptSize || adaptSel?.sizes[0]?.key || null, widthFt: adaptSel?.mode === 'area' ? adaptW : null, heightFt: adaptSel?.mode === 'area' ? adaptH : null }, 'Making the same look for your other product.');

  const reopen = () => run('reopen', async () => {
    if (!confirm('Change your mind? The design will be unlocked and you will need to approve it again before you can order.')) return;
    const r = await act(v.id, { action: 'reopen' });
    if (!r.ok) return say('bad', r.error!);
    setSpell(false); await refresh(); say('good', 'Reopened. Make your changes, then approve again.');
  });

  const order = () => run('order', async () => {
    const r = await act(v.id, { action: 'order', quantity: qty });
    if (!r.ok) return say('bad', r.error!);
    router.push(r.next);
  });

  const del = () => run('delete', async () => {
    if (!confirm('Delete this design, its words and pictures? This cannot be undone.')) return;
    const r = await act(v.id, { action: 'delete' });
    if (!r.ok) return say('bad', r.error!);
    router.push(r.next ?? '/studio/projects');
  });

  const fixOption = async (id: string) => {
    if (!selected) return;
    if (id === 'upgrade') return buy('upgrade');
    if (id === 'designer') return router.push('/custom-order');
    if (id === 'shorten') { detailsRef.current?.setAttribute('open', ''); detailsRef.current?.scrollIntoView({ behavior: 'smooth' }); return say('neutral', 'Shorten the long line below, then press “Apply my words to this design”.'); }
    if (id === 'bigger_photo') { detailsRef.current?.setAttribute('open', ''); detailsRef.current?.scrollIntoView({ behavior: 'smooth' }); return say('neutral', 'Add a bigger photo below, then press “Apply my words to this design”.'); }
    if (id === 'no_photo') {
      return run('nophoto', async () => {
        const del = await fetch(`/api/studio/projects/${v.id}/assets`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'photo' }) }).then((r) => r.json()).catch(() => null);
        if (!del?.ok) return say('bad', del?.error ?? 'We could not remove the photo.');
        const r = await act(v.id, { action: 'tweak', fromVersionId: selected.id, brief: draft });
        if (!r.ok) return say('bad', r.error!);
        picked.current = false; await refresh(); setSel(r.versionId); say('good', 'Made again without the photo.');
      });
    }
    if (id === 'smaller') {
      if (v.tier === 'premium') { return say('neutral', 'Use “The same look on another product” to make it again at a smaller size.'); }
      return router.push(`/studio/new?product=${v.product.slug}`);
    }
  };

  // ---- the page ----
  const hasPaid = paidVersions.length > 0;
  const canSketch = !v.tier && v.access.ok && v.sketches.limit > 0;
  const unpaidNeedsPremium = v.product.needsPremium;
  const helpWords = useMemo(() => v.occasion.lines.filter((l) => selected?.brief?.lines?.[l.id]).map((l) => ({ label: l.label, text: selected!.brief!.lines[l.id] })), [v.occasion.lines, selected]);
  const selRatio = selected?.w && selected?.h ? `${selected.w} / ${selected.h}` : '3 / 4';
  const share_ = v.share;
  const reviewing = approved && v.approval.humanCheck && v.approval.review?.status === 'waiting';
  const ordered = v.order && v.order.status !== 'draft';
  const inOrder = !!v.orderLine && v.orderLine.open && !v.tier;
  const paidInOrder = !!v.orderLine && !v.orderLine.open;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[30px] leading-tight sm:text-[40px]">{v.title || v.occasion.label}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[15px] text-muted">
          <span>{v.product.label}</span>
          {v.tier ? <span className="pill bg-accent text-ink capitalize">{v.tier}</span> : <span className="pill bg-placeholder text-ink">Not unlocked yet</span>}
          {approved && <span className="pill bg-good-tint text-good">Approved</span>}
        </p>
      </div>

      <div aria-live="polite" className="grid gap-2">
        {msg && <Toast tone={msg.tone}>{msg.text}</Toast>}
        {!v.access.ok && <Toast tone="warn">{v.access.message}</Toast>}
        {v.busy && !v.tier && <Toast tone="warn">Studio is very busy and not taking new designs for a short while. Nothing has been charged. Please try again soon.</Toast>}
        {v.working && <Toast tone="neutral"><span className="flex items-center gap-2"><Spinner className="h-4 w-4" /> Working on your design. This usually takes up to a minute or two. You can leave this page; we will message you when it is ready.</span></Toast>}
      </div>

      {/* ---------- the words ---------- */}
      <details ref={detailsRef} className="card group" open={formOpenAtStart}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 sm:p-6">
          <span className="text-[22px] font-bold">Your words, look and pictures</span>
          <span className="text-[14px] text-muted group-open:hidden">Open</span><span className="hidden text-[14px] text-muted group-open:inline">Close</span>
        </summary>
        <div className="grid gap-6 border-t border-line p-5 sm:p-6">
          {locked && <Toast tone="neutral">This design is approved and locked. Reopen it below if something must change.</Toast>}
          <BriefForm v={v} draft={draft} onChange={onDraft} locked={locked} onAssetsChanged={refresh} onConsent={giveConsent} />
          {!locked && (
            <div className="flex flex-wrap gap-3">
              {hasPaid && selected && selected.status === 'ready' ? (
                <button type="button" className="btn-primary" onClick={apply} disabled={!!busy}>{busy === 'tweak' ? 'Applying…' : 'Apply my words to this design'}<span className="ml-2 rounded-full bg-ink/10 px-2 text-[12px]">free</span></button>
              ) : null}
              <button type="button" className={hasPaid ? 'btn-secondary' : 'btn-primary'} onClick={saveOnly} disabled={!!busy || !dirty}>{busy === 'save' ? 'Saving…' : dirty ? 'Save' : 'Saved'}</button>
            </div>
          )}
        </div>
      </details>

      {/* ---------- start: free sketches and unlocking ---------- */}
      {paidInOrder && !v.tier && <Toast tone="good">Your payment for order {v.orderLine!.code} is in. We are starting your designs now.</Toast>}
      {!v.tier && !paidInOrder && (
        <section ref={startRef} id="start" className="card grid gap-5 p-5 sm:p-6" aria-labelledby="start-h">
          <h2 id="start-h" className="text-[24px]">{inOrder ? 'See it, then add it to your order' : 'See it, then unlock it'}</h2>
          {inOrder && v.orderLine!.tier && (
            <Toast tone="good"><span className="flex flex-wrap items-center gap-3"><span>Your <strong className="capitalize">{v.orderLine!.tier}</strong> design is in your order ({v.orderLine!.fee} added to the price). Studio starts when you pay.</span><a className="btn-primary btn-sm" href="/basket">Go to my basket</a><button type="button" className="link text-[14px]" onClick={takeOut} disabled={!!busy}>Take it out</button></span></Toast>
          )}
          {!v.phoneVerified ? (
            <PhoneVerify onDone={refresh} />
          ) : (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn-secondary" onClick={sketch} disabled={!!busy || !canSketch || v.sketches.left <= 0 || !!v.sketches.resting || v.working}>
                  {busy === 'sketch' ? 'Starting…' : sketches.length ? 'Make another free sketch' : 'Show me a free sketch'}
                </button>
                <span className="text-[14px] text-muted">{v.sketches.left} of {v.sketches.limit} free sketches left this week</span>
              </div>
              {v.sketches.resting && <p className="text-[14px] text-muted">{v.sketches.resting === 'off' ? 'Free sketches are not available right now.' : 'Free sketches are resting for today to keep Studio fair. Come back tomorrow, or unlock a design now.'}</p>}
              {v.sketches.left <= 0 && v.sketches.nextAt && <p className="text-[14px] text-muted">Your free sketches come back on {when(v.sketches.nextAt)}.</p>}
              <p className="text-[14px] text-muted">A sketch is small and has a “Brandit Studio” mark. It shows your own words on a real layout. Paid designs are full quality with no mark.</p>
            </div>
          )}

          <hr className="border-line" />
          {unpaidNeedsPremium && <Toast tone="warn">This print size is large, so it needs a Premium design to stay sharp. Standard is for smaller sizes.</Toast>}
          <div className="grid gap-4 md:grid-cols-2">
            {!unpaidNeedsPremium && v.tiers.standard && (
              <div className="grid content-start gap-3 rounded-md2 border-2 border-line-control p-4">
                <p className="font-display text-[22px] font-extrabold">Standard <span className="tabular">{v.prices.standard}</span></p>
                <p className="text-[15px] text-muted">{v.usage.concepts.total} designs, 2 rounds of changes, a checked print file. {v.prices.creditStandard} off your print order.</p>
                {inOrder ? (
                  <button type="button" className="btn-primary" onClick={() => addToOrder('standard')} disabled={!!busy || v.busy}>{busy === 'add:standard' ? 'One moment…' : v.orderLine!.tier === 'standard' ? 'Standard is in your order' : `Add Standard to my order · ${v.fees.standard}`}</button>
                ) : (
                  <button type="button" className="btn-primary" onClick={() => buy('standard')} disabled={!!busy || v.busy}>{busy === 'buy:standard' ? 'One moment…' : `Unlock Standard · ${v.prices.standard}`}</button>
                )}
                {inOrder && <p className="text-[13px] text-muted">{v.prices.standard} for the design, less {v.prices.creditStandard} off your print, so {v.fees.standard} more on this order.</p>}
                {!inOrder && v.wallet.standardCredits > 0 && <button type="button" className="btn-secondary" onClick={usePack} disabled={!!busy}>Use 1 of my {v.wallet.standardCredits} pack designs</button>}
              </div>
            )}
            {v.tiers.premium && (
              <div className="grid content-start gap-3 rounded-md2 border-2 border-ink p-4">
                <p className="font-display text-[22px] font-extrabold">Premium <span className="tabular">{v.prices.premium}</span></p>
                <p className="text-[15px] text-muted">Drafts, then finished designs. Vector file included, a Brandit designer checks it, and the same look on more products. {v.prices.creditPremium} off your print order.</p>
                {inOrder ? (
                  <button type="button" className="btn-primary" onClick={() => addToOrder('premium')} disabled={!!busy || v.busy}>{busy === 'add:premium' ? 'One moment…' : v.orderLine!.tier === 'premium' ? 'Premium is in your order' : `Add Premium to my order · ${v.fees.premium}`}</button>
                ) : (
                  <button type="button" className="btn-primary" onClick={() => buy('premium')} disabled={!!busy || v.busy}>{busy === 'buy:premium' ? 'One moment…' : `Unlock Premium · ${v.prices.premium}`}</button>
                )}
                {inOrder && <p className="text-[13px] text-muted">{v.prices.premium} for the design, less {v.prices.creditPremium} off your print, so {v.fees.premium} more on this order.</p>}
              </div>
            )}
          </div>
          {v.likedVersionId && <p className="text-[14px] text-muted">We will start from the sketch you liked.</p>}
          <p className="text-[13px] text-muted">If a paid design cannot be made, your money is returned by itself.</p>
        </section>
      )}

      {/* ---------- the designs ---------- */}
      {vs.length > 0 && (
        <section aria-labelledby="designs-h" className="grid gap-4">
          <h2 id="designs-h" className="text-[24px]">{hasPaid ? 'Your designs' : 'Your free sketches'}</h2>
          {[{ title: 'Your designs', list: paidVersions }, { title: 'Free sketches', list: sketches }].filter((g) => g.list.length > 0).map((g) => (
            <div key={g.title} className="grid gap-2">
              {hasPaid && sketches.length > 0 && <h3 className="text-[17px] font-bold text-muted">{g.title}</h3>}
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {g.list.map((x) => (
                  <li key={x.id}>
                    <button type="button" onClick={() => x.status === 'ready' && pick(x.id)} aria-pressed={sel === x.id} disabled={x.status !== 'ready'}
                      className={`card grid w-full content-start gap-1 overflow-hidden text-left ${sel === x.id ? 'border-2 border-ink shadow-press-sm' : 'hover:border-ink'}`}>
                      <div className="relative grid place-items-center bg-paper2" style={{ aspectRatio: x.w && x.h ? `${x.w} / ${x.h}` : '3 / 4', maxHeight: 340 }}>
                        {x.preview ? <img src={x.preview} alt={`${labelOf(vs, x)}`} className="h-full w-full object-contain" loading="lazy" /> : x.status === 'failed' || x.status === 'blocked' ? <span className="p-3 text-center text-[13px] text-bad">{x.error}</span> : <span className="grid place-items-center gap-2 p-3 text-center text-[13px] text-muted"><Spinner className="h-6 w-6" />Making…</span>}
                        {x.approved && <span className="pill absolute left-2 top-2 bg-good text-white">Approved</span>}
                        {v.likedVersionId === x.id && <span className="pill absolute right-2 top-2 bg-accent text-ink">You liked this</span>}
                      </div>
                      <p className="px-3 pb-3 pt-1 text-[14px] font-bold">{labelOf(vs, x)}{x.note ? <span className="block truncate text-[12px] font-normal text-muted">“{x.note}”</span> : null}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {/* ---------- the chosen design ---------- */}
      {selected && selected.status === 'ready' && selected.preview && (
        <section aria-labelledby="sel-h" className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
          <div className="grid gap-2 lg:sticky lg:top-24">
            <h2 id="sel-h" className="sr-only">Selected design</h2>
            <div className="relative mx-auto w-full overflow-hidden rounded-md2 border border-line bg-paper2" style={{ aspectRatio: selRatio, maxHeight: '75vh' }}>
              <img src={selected.preview} alt={`${labelOf(vs, selected)} — flat print preview`} className="h-full w-full object-contain" />
              {guides && <div aria-hidden="true" className="pointer-events-none absolute border-2 border-dashed border-accent" style={{ inset: `${safePct}%`, boxShadow: '0 0 0 9999px rgba(11,31,51,.18)' }} />}
            </div>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-[14px]">
              <input type="checkbox" className="h-5 w-5 accent-ink" checked={guides} onChange={(e) => setGuides(e.target.checked)} />Show the safe area (words stay inside the dashed line so nothing is trimmed off)
            </label>
            <p className="text-[13px] text-muted">{selected.spec?.label ?? v.product.label}. This is a flat preview of the print file, not a photo of the finished product.</p>
          </div>

          <div className="grid gap-4">
            {selected.kind === 'sketch' ? (
              <div className="card grid gap-3 p-5">
                <p className="font-bold">A free sketch</p>
                <p className="text-[15px] text-muted">Like the layout? Tell us, then unlock a design. We will start the full-quality version from this look.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary btn-sm" disabled={!!busy || v.likedVersionId === selected.id} onClick={() => simple('like', { action: 'like', versionId: selected.id }, 'Noted. We will start from this look.')}>{v.likedVersionId === selected.id ? 'You liked this' : 'I like this one'}</button>
                  {!v.tier && <a href="#start" className="btn-primary btn-sm">Unlock a design</a>}
                </div>
              </div>
            ) : (
              <>
                {!approved && (
                  <div className="card grid gap-3 p-5">
                    <p className="font-bold">Change the look</p>
                    <label className="sr-only" htmlFor="note">What should change?</label>
                    <textarea id="note" className="field py-3" rows={2} maxLength={300} placeholder="For example: more gold, less busy, make the top calmer" value={note} onChange={(e) => setNote(e.target.value)} />
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" className="btn-primary btn-sm" onClick={change} disabled={!!busy || v.usage.busy > 0 || !v.usage.canRevise || note.trim().length < 3}>{busy === 'change' ? 'Starting…' : 'Ask for changes'}</button>
                      <span className="text-[14px] text-muted">{v.usage.rounds.used} of {v.usage.rounds.total} {v.usage.rounds.label} used</span>
                    </div>
                    {!v.usage.canRevise && (
                      <div className="flex flex-wrap items-center gap-3 rounded-sm2 bg-warn-tint p-3 text-[15px]">
                        <span>You have used all your {v.usage.rounds.label}.</span>
                        <button type="button" className="btn-secondary btn-sm" onClick={() => buy('round')} disabled={!!busy}>Add one more · {v.tier === 'premium' ? v.prices.roundPremium : v.prices.roundStandard}</button>
                      </div>
                    )}
                    <p className="text-[13px] text-muted">To fix a name, date or number, change the words above. That is free and does not use a round.</p>
                  </div>
                )}

                {!approved && v.tier === 'premium' && (
                  <div className="card grid gap-3 p-5">
                    {selected.kind === 'draft' && (
                      <div className="grid gap-2">
                        <p className="font-bold">Make this a Premium final</p>
                        <p className="text-[15px] text-muted">The finest version of this draft. {v.usage.finals.used} of {v.usage.finals.total} used.</p>
                        <button type="button" className="btn-secondary btn-sm w-fit" onClick={premiumFinal} disabled={!!busy || !v.usage.canFinal || v.usage.busy > 0}>Make a Premium final</button>
                      </div>
                    )}
                    <div className="grid gap-2">
                      <p className="font-bold">The same look on another product</p>
                      <p className="text-[15px] text-muted">{v.usage.extraProducts.used} of {v.usage.extraProducts.total} used.</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <select aria-label="Product" className="field" value={adaptSlug} onChange={(e) => { setAdaptSlug(e.target.value); setAdaptSize(''); }}>
                          <option value="">Choose a product</option>
                          {adaptProducts.filter((p) => p.slug !== selected.spec?.slug).map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                        </select>
                        {adaptSel && adaptSel.mode === 'size' && adaptSel.sizes.length > 1 && (
                          <select aria-label="Size" className="field" value={adaptSize || adaptSel.sizes[0].key} onChange={(e) => setAdaptSize(e.target.value)}>{adaptSel.sizes.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
                        )}
                        {adaptSel && adaptSel.mode === 'area' && (
                          <div className="grid grid-cols-2 gap-2"><input aria-label="Width in feet" className="field" inputMode="decimal" value={adaptW} onChange={(e) => setAdaptW(e.target.value)} /><input aria-label="Height in feet" className="field" inputMode="decimal" value={adaptH} onChange={(e) => setAdaptH(e.target.value)} /></div>
                        )}
                      </div>
                      <button type="button" className="btn-secondary btn-sm w-fit" onClick={adapt} disabled={!!busy || !adaptSlug || !v.usage.canAdapt}>Make it</button>
                    </div>
                  </div>
                )}

                {/* print file and the sharpness check */}
                <div className="card grid gap-3 p-5" aria-live="polite">
                  <p className="font-bold">Print file</p>
                  {selected.finish.status === 'none' || selected.finish.status === 'failed' ? (
                    <>
                      {selected.finish.error && <Toast tone="bad">{selected.finish.error}</Toast>}
                      <p className="text-[15px] text-muted">Brandit builds the full-size file for {selected.spec?.label ?? 'your product'} and checks it is sharp enough to print.</p>
                      <button type="button" className="btn-primary btn-sm w-fit" onClick={() => finish(selected.id)} disabled={!!busy}>{selected.finish.status === 'failed' ? 'Try again' : 'Prepare my print file'}</button>
                    </>
                  ) : selected.finish.status === 'queued' || selected.finish.status === 'running' ? (
                    <p className="flex items-center gap-2 text-[15px]"><Spinner className="h-4 w-4" />Building the full-size file and checking sharpness…</p>
                  ) : selected.check ? (
                    <>
                      <p className="flex items-start gap-2 font-bold"><StatusIcon status={selected.check.status} />{selected.check.headline}</p>
                      <ul className="grid gap-2">
                        {selected.check.lines.map((l) => (
                          <li key={l.id} className="flex items-start gap-2 text-[15px]"><StatusIcon status={l.status} /><span><span className="font-bold">{l.label}.</span> {l.message}</span></li>
                        ))}
                      </ul>
                      {selected.check.status === 'stop' && (
                        <div className="grid gap-2 rounded-sm2 bg-bad-tint p-3">
                          <p className="font-bold">Choose how to fix it</p>
                          <div className="flex flex-wrap gap-2">
                            {selected.check.options.map((o) => <button key={o.id} type="button" className="btn-secondary btn-sm" onClick={() => fixOption(o.id)} disabled={!!busy}>{o.label}</button>)}
                          </div>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {selected.files.png && <a className="btn-secondary btn-sm" href={`/api/studio/v/${selected.id}?k=final`}>Download print file</a>}
                        {selected.files.pdf && <a className="btn-secondary btn-sm" href={`/api/studio/v/${selected.id}?k=pdf`}>Download PDF</a>}
                      </div>
                    </>
                  ) : null}
                </div>

                {/* vector */}
                {selected.finish.status === 'done' && (
                  <div className="card grid gap-2 p-5">
                    <p className="font-bold">Vector file <span className="text-[13px] font-normal text-muted">(for any size, and for sign-makers)</span></p>
                    {selected.files.svg ? (
                      <a className="btn-secondary btn-sm w-fit" href={`/api/studio/v/${selected.id}?k=svg`}>Download vector file</a>
                    ) : selected.vector === 'queued' || selected.vector === 'running' ? (
                      <p className="flex items-center gap-2 text-[15px]"><Spinner className="h-4 w-4" />Making your vector file…</p>
                    ) : v.tier === 'premium' ? (
                      <button type="button" className="btn-secondary btn-sm w-fit" onClick={() => makeVector(selected.id)} disabled={!!busy}>{selected.vector === 'failed' ? 'Try again' : 'Make the vector file (included)'}</button>
                    ) : (
                      <button type="button" className="btn-secondary btn-sm w-fit" onClick={() => buy('vector', selected.id)} disabled={!!busy}>Get the vector file · {v.prices.vector}</button>
                    )}
                  </div>
                )}

                {/* approve */}
                {!approved && selected.finish.status === 'done' && selected.check && selected.check.status !== 'stop' && (
                  <div className="card grid gap-3 border-2 border-ink p-5">
                    <p className="text-[18px] font-bold">Approve this design</p>
                    <p className="text-[15px] text-muted">Read every word as it will print. Once approved, the file is locked.</p>
                    <dl className="grid gap-2 rounded-sm2 bg-paper2 p-3">
                      {helpWords.length === 0 && <p className="text-[15px] text-muted">No words on this design.</p>}
                      {helpWords.map((w) => (<div key={w.label}><dt className="text-[12px] font-bold uppercase tracking-wide text-muted">{w.label}</dt><dd className="font-display text-[20px] font-extrabold leading-tight">{w.text}</dd></div>))}
                    </dl>
                    <label className="flex cursor-pointer items-start gap-3">
                      <input type="checkbox" className="mt-1 h-5 w-5 accent-ink" checked={spell} onChange={(e) => setSpell(e.target.checked)} />
                      <span className="text-[15px]">I have checked every name, date and phone number. They are spelled right.</span>
                    </label>
                    <button type="button" className="btn-primary" onClick={approve} disabled={!spell || !!busy}>{busy === 'approve' ? 'Approving…' : 'Approve this design'}</button>
                    {!v.approval.humanCheck && v.tier === 'standard' && (
                      <p className="text-[14px] text-muted">Want a Brandit designer to look it over before it prints? <button type="button" className="link" onClick={() => buy('check')} disabled={!!busy}>Add a check for {v.prices.check}</button>.</p>
                    )}
                  </div>
                )}

                {/* sharing */}
                {!approved && (
                  <div className="card grid gap-2 p-5">
                    <p className="font-bold">Show family or your committee</p>
                    {share_.versionId === selected.id ? (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <input readOnly aria-label="Share link" className="field min-w-0 grow" value={share_.url} onFocus={(e) => e.currentTarget.select()} />
                          <button type="button" className="btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(share_.url).then(() => setMsg({ tone: 'good', text: 'Link copied.' }))}>Copy</button>
                          <a className="btn-secondary btn-sm" href={`https://wa.me/?text=${encodeURIComponent(`See my design and tell me what you think: ${share_.url}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                        </div>
                        <button type="button" className="link w-fit text-[14px]" onClick={() => share(null)}>Stop sharing</button>
                      </>
                    ) : (
                      <button type="button" className="btn-secondary btn-sm w-fit" onClick={() => share(selected.id)} disabled={!!busy}>Get a link to share this design</button>
                    )}
                    <p className="text-[13px] text-muted">They see this one preview, nothing else, and can say “I like it” or ask for a change. No sign-in needed.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* ---------- feedback from the share link ---------- */}
      {v.feedback.length > 0 && (
        <section aria-labelledby="fb-h" className="card grid gap-3 p-5">
          <h2 id="fb-h" className="text-[20px]">What your family said</h2>
          <ul className="grid gap-2">
            {v.feedback.map((f) => (
              <li key={f.id} className="flex items-start gap-3 text-[15px]"><span className={`pill ${f.verdict === 'like' ? 'bg-good-tint text-good' : 'bg-warn-tint text-warn'}`}>{f.verdict === 'like' ? 'Likes it' : 'Change'}</span><span><strong>{f.name}</strong>{f.note ? `: ${f.note}` : ''}</span></li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- approved: order ---------- */}
      {approved && (
        <section aria-labelledby="ord-h" className="card grid gap-4 border-2 border-ink p-5 sm:p-6">
          <h2 id="ord-h" className="text-[24px]">Approved{v.approval.at ? ` on ${when(v.approval.at)}` : ''}</h2>
          <p className="text-[14px] text-muted">This design is locked. File fingerprint <span className="tabular font-bold">{v.approval.sha}</span>. What you approved is exactly what prints.</p>
          {reviewing && <Toast tone="warn">A Brandit designer is checking your design ({v.hours}). We will message you as soon as it is ready to order.</Toast>}
          {approved && v.approval.review?.status === 'changes' && <Toast tone="warn"><strong>A Brandit designer left a note:</strong> {v.approval.review.note || 'Please look at the design again.'}</Toast>}
          {v.approval.review?.status === 'passed' && <Toast tone="good">A Brandit designer checked your design and it is ready to print.</Toast>}
          {ordered ? (
            <div className="flex flex-wrap items-center gap-3"><span className="font-bold">Ordered: {v.order!.code}</span><a className="btn-secondary btn-sm" href={`/checkout/${v.order!.id}`}>Open my order</a>{paidInOrder && <span className="text-[14px] text-muted">Your design is on the order. It goes to our file desk to be checked, then it prints.</span>}</div>
          ) : v.approval.ready ? (
            <div className="grid gap-3">
              {v.credit.kobo > 0 && <p className="rounded-sm2 bg-good-tint p-3 text-[15px]"><strong>{naira(v.credit.kobo)} off</strong> your print order for this design{v.credit.endsAt ? `, until ${when(v.credit.endsAt)}` : ` for ${v.creditDays} days`}. It is applied automatically.</p>}
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="label" htmlFor="qty">How many to print</label>
                  {quantities.length > 0 ? (
                    <select id="qty" className="field w-auto min-w-[140px]" value={qty} onChange={(e) => setQty(Number(e.target.value))}>{quantities.map((q) => <option key={q} value={q}>{q.toLocaleString('en-NG')}</option>)}</select>
                  ) : (
                    <input id="qty" className="field w-[140px]" inputMode="numeric" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))} />
                  )}
                </div>
                <button type="button" className="btn-primary" onClick={order} disabled={!!busy}>{busy === 'order' ? 'One moment…' : 'Print this with Brandit'}</button>
              </div>
              <p className="text-[13px] text-muted">You will see your price and delivery time before you pay.</p>
            </div>
          ) : null}
          {!ordered && <button type="button" className="link w-fit text-[14px]" onClick={reopen} disabled={!!busy}>I need to change something</button>}
        </section>
      )}

      <p className="text-[13px] text-muted">
        We keep this design until {when(v.keepUntil) || `${v.keepDays} days after you last open it`}, then delete the words and pictures. Designs on a paid order are kept with the order.{' '}
        <button type="button" className="link" onClick={del} disabled={!!busy}>Delete this design now</button>
      </p>
    </div>
  );
}
