'use client';
import { useMemo, useRef, useState } from 'react';
import { MAX_QUANTITY } from '@/lib/pricing';
import { applyBulk, marginOf, parseNaira, parsePaste, priceForMargin, type BulkOp, type GridRow } from '@/lib/priceGrid';
import type { AreaCell, GridCell, GridCol } from '@/lib/priceAdmin';

/*
 * The price grid: a table like the spreadsheet the shop already keeps. One row for every combination of the choices
 * that pick the price (paper, size, card...), one column for every quantity (or size). Type in a box, or copy a block
 * from Excel and paste it in. Nothing is saved until "Save prices", and only the boxes that were touched are sent, so
 * a placeholder price you never touched stays marked as a placeholder.
 */

type Val = { p: string; c: string; min: string; touched: boolean };
type Props = {
  id: string;
  mode: 'tier' | 'size' | 'area';
  rows: GridRow[];
  cols: GridCol[];
  cells: Record<string, GridCell>;
  area: Record<string, AreaCell> | null;
  targetMarginPct: number;
  customQuantity: boolean;
  action: (fd: FormData) => void;
};

const plain = (k: number | null | undefined) => (k == null ? '' : String(k / 100));
const fmt = (k: number) => `₦${(k / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const PRESETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

export function PriceGrid({ id, mode, rows, cols: initialCols, cells, area, targetMarginPct, action }: Props) {
  const initial = useMemo(() => {
    const v: Record<string, Val> = {};
    if (area) for (const r of rows) { const a = area[r.id]; v[`${r.id}|a`] = { p: plain(a?.rate), c: plain(a?.cost), min: a?.minArea != null ? String(a.minArea) : '', touched: false }; }
    else for (const r of rows) for (const c of initialCols) { const x = cells[`${r.id}|${c.id}`]; v[`${r.id}|${c.id}`] = { p: plain(x?.price), c: plain(x?.cost), min: '', touched: false }; }
    return v;
  }, [rows, initialCols, cells, area]);

  const [vals, setVals] = useState<Record<string, Val>>(initial);
  const [quantities, setQuantities] = useState<number[]>(() => (mode === 'tier' ? initialCols.map((c) => c.quantity!) : []));
  const [newQty, setNewQty] = useState('');
  const [showCost, setShowCost] = useState(() => Object.values(initial).some((v) => v.c !== ''));
  const [pickRows, setPickRows] = useState<Set<string>>(new Set());
  const [pickCols, setPickCols] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ scope: 'all' | 'rows' | 'cols'; field: 'p' | 'c'; mode: BulkOp['mode']; value: string; round: BulkOp['round'] }>({ scope: 'all', field: 'p', mode: 'percent', value: '', round: '100' });
  const [note, setNote] = useState('');
  const table = useRef<HTMLTableElement>(null);

  const cols: GridCol[] = mode === 'tier' ? quantities.map((q) => ({ id: `q:${q}`, label: q.toLocaleString('en-US'), quantity: q })) : initialCols;
  const colIds = mode === 'area' ? ['a'] : cols.map((c) => c.id);
  const get = (r: string, c: string): Val => vals[`${r}|${c}`] ?? { p: '', c: '', min: '', touched: false };
  const set = (r: string, c: string, patch: Partial<Val>) => setVals((all) => ({ ...all, [`${r}|${c}`]: { ...get(r, c), ...patch, touched: true } }));

  // Which boxes differ from what is saved, or were typed in.
  const send = useMemo(() => {
    const out: { row: string; col: string; price: string; cost: string; min?: string; confirm: boolean }[] = [];
    for (const r of rows) for (const c of colIds) {
      const k = `${r.id}|${c}`;
      const v = vals[k] ?? { p: '', c: '', min: '', touched: false };
      const o = initial[k] ?? { p: '', c: '', min: '', touched: false };
      if (v.touched || v.p !== o.p || v.c !== o.c || v.min !== o.min) out.push({ row: r.id, col: c, price: v.p, cost: v.c, min: v.min, confirm: v.touched });
    }
    return out;
  }, [vals, rows, colIds.join(','), initial]);
  const removedCols = mode === 'tier' ? initialCols.filter((c) => !quantities.includes(c.quantity!)).length : 0;
  const addedCols = mode === 'tier' ? quantities.filter((q) => !initialCols.some((c) => c.quantity === q)).length : 0;
  const dirty = send.length > 0 || removedCols > 0 || addedCols > 0;

  const bad = (text: string) => text.trim() !== '' && parseNaira(text) === undefined;
  const anyBad = send.some((s) => bad(s.price) || bad(s.cost));
  const entered = rows.reduce((n, r) => n + colIds.filter((c) => get(r.id, c).p.trim() !== '').length, 0);
  const total = rows.length * colIds.length;
  const placeholders = (() => {
    let n = 0;
    for (const r of rows) for (const c of colIds) {
      const x = area ? area[r.id] : cells[`${r.id}|${c}`];
      if (x && 'placeholder' in x && x.placeholder && !get(r.id, c).touched) n++;
    }
    return n;
  })();

  // ---- Typing, pasting, moving ----
  function paste(e: React.ClipboardEvent<HTMLInputElement>, ri: number, ci: number, field: 'p' | 'c' | 'min') {
    const data = parsePaste(e.clipboardData.getData('text'));
    if (data.length === 1 && data[0].length === 1) return; // a single value: let the box take it
    e.preventDefault();
    const fields: ('p' | 'c' | 'min')[] = mode === 'area' ? ['p', 'min', 'c'] : [field];
    const patches: Record<string, Val> = {};
    let n = 0;
    data.forEach((line, dr) => line.forEach((text, dc) => {
      const r = rows[ri + dr];
      if (!r) return;
      let cid: string | undefined;
      let f: 'p' | 'c' | 'min' = field;
      if (mode === 'area') { const start = fields.indexOf(field); f = fields[start + dc]; cid = 'a'; } else cid = colIds[ci + dc];
      if (!cid || !f) return;
      const k = `${r.id}|${cid}`;
      const was = patches[k] ?? get(r.id, cid);
      const cleaned = f === 'min' ? text.replace(/[^\d.]/g, '') : text.replace(/[₦,\s]/g, '').replace(/^n(?=\d)/i, '');
      patches[k] = { ...was, [f]: cleaned, touched: true };
      n++;
    }));
    setVals((all) => ({ ...all, ...patches }));
    setNote(`Pasted ${n} box${n === 1 ? '' : 'es'}. Check them, then press Save prices.`);
  }
  function key(e: React.KeyboardEvent<HTMLInputElement>, ri: number, ci: number, tag: string) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = table.current?.querySelector<HTMLInputElement>(`[data-r="${ri + (e.shiftKey ? -1 : 1)}"][data-c="${ci}"][data-f="${tag}"]`);
    next?.focus();
    next?.select();
  }

  // ---- Columns ----
  function addQty(q: number) {
    if (!(q >= 1 && q <= MAX_QUANTITY)) { setNote(`A quantity must be between 1 and ${MAX_QUANTITY.toLocaleString('en-US')}.`); return; }
    if (quantities.includes(q)) { setNote(`${q.toLocaleString('en-US')} is already a column.`); return; }
    if (quantities.length >= 16) { setNote('Up to 16 quantity steps are allowed.'); return; }
    setQuantities((all) => [...all, q].sort((a, b) => a - b));
    setNewQty('');
    setNote(`Added ${q.toLocaleString('en-US')}. Fill in its prices, then press Save prices.`);
  }
  function removeQty(q: number) {
    const has = rows.some((r) => get(r.id, `q:${q}`).p.trim() !== '');
    if (has && !window.confirm(`Remove the ${q.toLocaleString('en-US')} column and its prices? They are deleted when you press Save prices.`)) return;
    setQuantities((all) => all.filter((x) => x !== q));
  }

  // ---- Bulk change ----
  function applyBulkChange() {
    const n = Number(bulk.value.replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(n) || bulk.value.trim() === '') { setNote('Type how much to change by, such as 10 (percent) or 500 (naira).'); return; }
    const op: BulkOp = { mode: bulk.mode, value: n, round: bulk.round };
    const targetRows = bulk.scope === 'rows' ? rows.filter((r) => pickRows.has(r.id)) : rows;
    const targetCols = bulk.scope === 'cols' ? colIds.filter((c) => pickCols.has(c)) : colIds;
    if ((bulk.scope === 'rows' && !targetRows.length) || (bulk.scope === 'cols' && !targetCols.length)) { setNote(`Tick the ${bulk.scope === 'rows' ? 'rows' : 'columns'} to change first.`); return; }
    const patches: Record<string, Val> = {};
    let count = 0;
    for (const r of targetRows) for (const c of targetCols) {
      const k = `${r.id}|${c}`;
      const v = get(r.id, c);
      const kobo = parseNaira(v[bulk.field]);
      if (kobo === undefined || kobo === null) continue;
      const next = applyBulk(kobo, op);
      patches[k] = { ...v, [bulk.field]: plain(next), touched: true };
      count++;
    }
    setVals((all) => ({ ...all, ...patches }));
    setNote(count ? `Changed ${count} ${bulk.field === 'p' ? 'price' : 'cost'}${count === 1 ? '' : 's'}. Look them over, then press Save prices.` : 'There was nothing to change in that selection.');
  }

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); setter(n); };
  const marginChip = (r: string, c: string) => {
    const v = get(r, c);
    const m = marginOf(parseNaira(v.p) ?? null, parseNaira(v.c) ?? null, targetMarginPct);
    if (!m) return null;
    const tone = m.level === 'loss' ? 'bg-bad-tint text-bad' : m.level === 'thin' ? 'bg-warn-tint text-warn' : 'bg-good-tint text-good';
    return <span className={`mt-1 inline-block rounded-full px-2 py-[1px] text-[12px] font-bold ${tone}`} title={m.level === 'loss' ? 'Sells for less than it costs' : m.level === 'thin' ? `Below your ${targetMarginPct}% target` : `At or above your ${targetMarginPct}% target`}>{m.level === 'loss' ? 'Loss' : `${Math.round(m.pct)}%`}</span>;
  };
  const cellTone = (r: string, c: string, field: 'p' | 'c') => {
    const v = get(r, c);
    const x = area ? area[r] : cells[`${r}|${c}`];
    const placeholder = !!x && 'placeholder' in x && x.placeholder && !v.touched && field === 'p';
    const changed = v[field] !== (initial[`${r}|${c}`]?.[field] ?? '');
    const invalid = bad(v[field]);
    return invalid ? 'border-bad bg-bad-tint' : changed || v.touched ? 'border-ink bg-[#EAF2FB]' : placeholder ? 'border-[#E0B84A] bg-warn-tint' : 'border-line-control bg-surface';
  };

  const payload = JSON.stringify({ quantities: mode === 'tier' ? quantities : undefined, cells: send });
  const boxCls = 'w-full min-h-[40px] rounded-sm2 border-2 px-2 text-[15px] text-right tabular-nums text-ink hover:border-ink focus-visible:outline-none focus-visible:border-ink focus-visible:shadow-focus';

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="json" value={payload} />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px]">
        <span><b>{entered}</b> of {total} prices entered</span>
        {placeholders > 0 && <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm border border-[#E0B84A] bg-warn-tint" aria-hidden />{placeholders} are placeholders</span>}
        <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm border border-ink bg-[#EAF2FB]" aria-hidden />changed, not saved yet</span>
        <label className="ml-auto inline-flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5 accent-[#0B1F33]" checked={showCost} onChange={(e) => setShowCost(e.target.checked)} />Show what it costs us</label>
      </div>

      <div className="overflow-x-auto rounded-md2 border border-line" role="region" aria-label="Price grid" tabIndex={0}>
        <table ref={table} className="w-full border-collapse text-[15px]">
          {mode === 'area' ? (
            <>
              <thead className="bg-paper2 text-left text-[13px] text-muted">
                <tr><th scope="col" className="sticky left-0 z-10 bg-paper2 px-3 py-2">Material</th><th scope="col" className="px-2 py-2 text-right">Price per sq ft (₦)</th><th scope="col" className="px-2 py-2 text-right">Smallest area charged (sq ft)</th>{showCost && <th scope="col" className="px-2 py-2 text-right">Cost per sq ft (₦)</th>}</tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-bold">{r.label}</th>
                    <td className="min-w-[130px] px-2 py-2"><input aria-label={`${r.label}: price per square foot`} data-r={ri} data-c={0} data-f="p" inputMode="decimal" className={`${boxCls} ${cellTone(r.id, 'a', 'p')}`} value={get(r.id, 'a').p} onChange={(e) => set(r.id, 'a', { p: e.target.value })} onPaste={(e) => paste(e, ri, 0, 'p')} onKeyDown={(e) => key(e, ri, 0, 'p')} /></td>
                    <td className="min-w-[130px] px-2 py-2"><input aria-label={`${r.label}: smallest area charged`} data-r={ri} data-c={1} data-f="min" inputMode="decimal" className={`${boxCls} ${cellTone(r.id, 'a', 'p').replace(/bg-\S+/g, 'bg-surface')}`} value={get(r.id, 'a').min} onChange={(e) => set(r.id, 'a', { min: e.target.value.replace(/[^\d.]/g, '') })} onPaste={(e) => paste(e, ri, 0, 'min')} onKeyDown={(e) => key(e, ri, 1, 'min')} /></td>
                    {showCost && <td className="min-w-[130px] px-2 py-2"><input aria-label={`${r.label}: cost per square foot`} data-r={ri} data-c={2} data-f="c" inputMode="decimal" className={`${boxCls} ${cellTone(r.id, 'a', 'c')}`} value={get(r.id, 'a').c} onChange={(e) => set(r.id, 'a', { c: e.target.value })} onPaste={(e) => paste(e, ri, 0, 'c')} onKeyDown={(e) => key(e, ri, 2, 'c')} />{marginChip(r.id, 'a')}</td>}
                  </tr>
                ))}
              </tbody>
            </>
          ) : (
            <>
              <thead className="bg-paper2 text-[13px] text-muted">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 min-w-[190px] bg-paper2 px-3 py-2 text-left">{rows.length > 1 || rows[0]?.label !== 'Price' ? 'Choices' : ''}</th>
                  {cols.map((c, ci) => (
                    <th key={c.id} scope="col" className="min-w-[116px] px-2 py-2 text-right">
                      <label className="inline-flex items-center gap-1 font-bold text-ink"><input type="checkbox" className="h-4 w-4 accent-[#0B1F33]" aria-label={`Select the ${c.label} column`} checked={pickCols.has(c.id)} onChange={() => toggle(pickCols, setPickCols, c.id)} />{c.label}</label>
                      {mode === 'tier' && <button type="button" className="ml-1 text-[12px] font-bold text-bad underline" aria-label={`Remove the ${c.label} column`} onClick={() => removeQty(c.quantity!)}>remove</button>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-bold">
                      <label className="inline-flex items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4 accent-[#0B1F33]" aria-label={`Select the ${r.label} row`} checked={pickRows.has(r.id)} onChange={() => toggle(pickRows, setPickRows, r.id)} /><span>{r.label}</span></label>
                    </th>
                    {cols.map((c, ci) => (
                      <td key={c.id} className="px-2 py-2">
                        <input aria-label={`${r.label}, ${c.label}: price in naira`} data-r={ri} data-c={ci} data-f="p" inputMode="decimal" className={`${boxCls} ${cellTone(r.id, c.id, 'p')}`} value={get(r.id, c.id).p} placeholder="—" onChange={(e) => set(r.id, c.id, { p: e.target.value })} onPaste={(e) => paste(e, ri, ci, 'p')} onKeyDown={(e) => key(e, ri, ci, 'p')} />
                        {showCost && (
                          <div className="mt-1">
                            <input aria-label={`${r.label}, ${c.label}: cost in naira`} data-r={ri} data-c={ci} data-f="c" inputMode="decimal" className={`${boxCls} !min-h-[34px] !text-[13px] ${cellTone(r.id, c.id, 'c')}`} value={get(r.id, c.id).c} placeholder="cost" onChange={(e) => set(r.id, c.id, { c: e.target.value })} onPaste={(e) => paste(e, ri, ci, 'c')} onKeyDown={(e) => key(e, ri, ci, 'c')} />
                            <div className="text-right">{marginChip(r.id, c.id)}</div>
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>
      </div>

      {mode === 'tier' && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="newq">Add a quantity</label>
            <div className="flex gap-2">
              <input id="newq" inputMode="numeric" className="field !min-h-[44px] max-w-[130px]" value={newQty} placeholder="750" onChange={(e) => setNewQty(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addQty(Number(newQty)); } }} />
              <button type="button" className="btn-secondary btn-sm" onClick={() => addQty(Number(newQty))}>Add</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1" aria-label="Quick quantities">
            {PRESETS.filter((q) => !quantities.includes(q)).map((q) => <button key={q} type="button" className="rounded-full border border-line-control px-3 py-1 text-[13px] font-bold hover:border-ink" onClick={() => addQty(q)}>+ {q.toLocaleString('en-US')}</button>)}
          </div>
        </div>
      )}

      <details className="rounded-md2 border border-line p-4">
        <summary className="cursor-pointer font-bold">Change many prices at once</summary>
        <div className="mt-3 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label className="label" htmlFor="b-scope">Change</label>
              <select id="b-scope" className="field !min-h-[44px]" value={bulk.scope} onChange={(e) => setBulk({ ...bulk, scope: e.target.value as typeof bulk.scope })}>
                <option value="all">Everything in the grid</option>
                <option value="rows">Only the ticked rows</option>
                {mode !== 'area' && <option value="cols">Only the ticked columns</option>}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="b-field">What</label>
              <select id="b-field" className="field !min-h-[44px]" value={bulk.field} onChange={(e) => setBulk({ ...bulk, field: e.target.value as 'p' | 'c' })}>
                <option value="p">Prices</option>
                <option value="c">Costs</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="b-mode">By</label>
              <select id="b-mode" className="field !min-h-[44px]" value={bulk.mode} onChange={(e) => setBulk({ ...bulk, mode: e.target.value as BulkOp['mode'] })}>
                <option value="percent">A percentage</option>
                <option value="amount">An amount in naira</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="b-val">{bulk.mode === 'percent' ? 'Percent (use - to lower)' : 'Naira (use - to lower)'}</label>
              <input id="b-val" inputMode="decimal" className="field !min-h-[44px]" value={bulk.value} placeholder={bulk.mode === 'percent' ? '10' : '500'} onChange={(e) => setBulk({ ...bulk, value: e.target.value.replace(/[^\d.-]/g, '') })} />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="b-round">Round to the nearest</label>
              <select id="b-round" className="field !min-h-[44px]" value={bulk.round} onChange={(e) => setBulk({ ...bulk, round: e.target.value as BulkOp['round'] })}>
                <option value="none">No rounding</option>
                <option value="10">₦10</option>
                <option value="50">₦50</option>
                <option value="100">₦100</option>
                <option value="500">₦500</option>
              </select>
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={applyBulkChange}>Apply to the grid</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setVals(initial); setQuantities(mode === 'tier' ? initialCols.map((c) => c.quantity!) : []); setNote('Everything is back to what is saved.'); }} disabled={!dirty}>Undo all my changes</button>
          </div>
          <p className="text-[13px] text-muted">This only changes the boxes on this screen. Nothing reaches customers until you press Save prices. Empty boxes stay empty.</p>
        </div>
      </details>

      {showCost && <p className="text-[13px] text-muted">Margin is the share of the price you keep after the cost. Your target is {targetMarginPct}%: a price that reaches it shows green, one below shows amber, and one below cost shows <b>Loss</b>. For example, a cost of ₦6,000 needs a price of {fmt(priceForMargin(600000, targetMarginPct))} to reach {targetMarginPct}%.</p>}

      <div className="flex flex-wrap items-center gap-3" aria-live="polite">
        <button className="btn-primary" disabled={!dirty || anyBad}>Save prices</button>
        <span className="text-[14px] text-muted">{anyBad ? 'Fix the boxes in red first: they are not amounts.' : dirty ? `${send.length} box${send.length === 1 ? '' : 'es'} changed${removedCols ? `, ${removedCols} column${removedCols === 1 ? '' : 's'} removed` : ''}${addedCols ? `, ${addedCols} column${addedCols === 1 ? '' : 's'} added` : ''}. Not saved yet.` : 'Nothing to save.'}</span>
        {note && <span className="text-[14px] font-bold">{note}</span>}
      </div>
    </form>
  );
}
