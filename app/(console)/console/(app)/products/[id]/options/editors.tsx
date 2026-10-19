'use client';
import { useState } from 'react';
import type { ChoiceIn, OptionIn, PackageForm } from '@/lib/optionsForm';
import type { Condition } from '@/lib/types';

/*
 * The editors for a product's options, packages and sizes. Each keeps its rows in state and hands the whole list to a
 * server action as one JSON field, so a save is all-or-nothing and a mistake saves nothing.
 */

const box = 'h-5 w-5 accent-[#0B1F33]';
const cls = 'field !min-h-[44px]';

type Ctx = { mode: 'tier' | 'size' | 'area'; sizes: { key: string; label: string }[] };
const blankChoice = (): ChoiceIn => ({ label: '', note: '', amount: '', per: 'order', setup: '', percent: '', cost: '', costPer: 'order', hidden: false, unpriced: false, only_if: null, by: null });
const blankOption = (): OptionIn => ({ label: '', help: '', kind: 'pick', special: false, drives: false, defaultIndex: 0, defaultIndexes: [], defaultCounts: [], only_if: null, auto: null, positions: false, choices: [blankChoice(), blankChoice()] });

const KIND_TEXT: Record<string, string> = { pick: 'Choose one', tick: 'Tick any', split: 'A count of each' };
const PER_TEXT: Record<string, string> = { order: 'Once per order', piece: 'Per piece', sqft: 'Per square foot', foot: 'Per foot around the edge', position: 'Per piece for each print position' };

// ---------- "Only when…" ----------
function Cond({ value, onChange, options, self, mode, label }: { value: Condition | null | undefined; onChange: (c: Condition | null) => void; options: OptionIn[]; self: number | null; mode: Ctx['mode']; label: string }) {
  const cond = value ?? {};
  const keys = Object.keys(cond);
  const usable = options.filter((o, i) => i !== self && o.key && o.choices.some((c) => c.value));
  const valuesFor = (k: string): { value: string; label: string }[] => (k === 'size' ? [] : (options.find((o) => o.key === k)?.choices.filter((c) => c.value) as { value: string; label: string }[]) ?? []);
  const set = (next: Condition) => onChange(Object.keys(next).length ? next : null);
  return (
    <div className="grid gap-2">
      <p className="label !mb-0">{label}</p>
      {keys.length === 0 && <p className="text-[13px] text-muted">Always. Add a rule to show this only when something else is chosen.</p>}
      {keys.map((k) => (
        <div key={k} className="rounded-sm2 border border-line bg-surface p-2">
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Only when this option" className={`${cls} !w-auto`} value={k} onChange={(e) => { const n: Condition = {}; for (const [kk, vv] of Object.entries(cond)) n[kk === k ? e.target.value : kk] = kk === k ? [] : vv; set(n); }}>
              <option value={k}>{options.find((o) => o.key === k)?.label ?? k}</option>
              {usable.filter((o) => o.key !== k && !(o.key! in cond)).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <span className="text-[14px]">is</span>
            <div className="flex flex-wrap gap-x-3">
              {valuesFor(k).map((v) => (
                <label key={v.value} className="inline-flex min-h-[40px] items-center gap-1.5 text-[14px]"><input type="checkbox" className={box} checked={(cond[k] ?? []).includes(v.value)} onChange={(e) => { const cur = new Set(cond[k] ?? []); if (e.target.checked) cur.add(v.value); else cur.delete(v.value); set({ ...cond, [k]: [...cur] }); }} />{v.label}</label>
              ))}
            </div>
            <button type="button" className="btn-ghost btn-sm !text-bad" onClick={() => { const n = { ...cond }; delete n[k]; set(n); }}>Remove</button>
          </div>
        </div>
      ))}
      {usable.filter((o) => !(o.key! in cond)).length > 0 && (
        <select aria-label="Add a rule" className={`${cls} !w-auto self-start`} value="" onChange={(e) => { if (e.target.value) set({ ...cond, [e.target.value]: [] }); }}>
          <option value="">{keys.length ? 'And only when…' : 'Add a rule…'}</option>
          {usable.filter((o) => !(o.key! in cond)).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      )}
      {options.some((o, i) => i !== self && !o.key) && <p className="text-[12px] text-muted">New options can be used in a rule after you save once.</p>}
      {mode === 'size' && !('size' in cond) && <button type="button" className="btn-ghost btn-sm self-start" onClick={() => set({ ...cond, size: [] })}>Only for certain sizes…</button>}
    </div>
  );
}

// ---------- One choice ----------
function ChoiceRow({ c, j, o, i, options, ctx, patch, remove, move, last }: { c: ChoiceIn; j: number; o: OptionIn; i: number; options: OptionIn[]; ctx: Ctx; patch: (p: Partial<ChoiceIn>) => void; remove: () => void; move: (d: number) => void; last: boolean }) {
  const kind = o.kind ?? 'pick';
  const positionsExist = options.some((x) => x.positions);
  const priced = !!(c.amount || c.setup || c.percent || (c.by && Object.values(c.by.amounts).some(Boolean)));
  const dependsOn = c.by?.key;
  const byValues = dependsOn === 'size' ? ctx.sizes.map((s) => ({ value: s.key, label: s.label })) : (options.find((x) => x.key === dependsOn)?.choices.filter((x) => x.value) as { value: string; label: string }[] | undefined) ?? [];
  return (
    <div className="grid gap-2 rounded-sm2 border border-line bg-surface p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[150px] flex-1"><label className="label" htmlFor={`cl-${i}-${j}`}>Choice</label><input id={`cl-${i}-${j}`} className={cls} value={c.label} maxLength={40} placeholder="Gloss" onChange={(e) => patch({ label: e.target.value })} /></div>
        <div className="w-[120px]"><label className="label" htmlFor={`ce-${i}-${j}`}>Extra (₦)</label><input id={`ce-${i}-${j}`} inputMode="decimal" className={cls} value={c.amount ?? ''} placeholder="0" disabled={!!c.by} title={c.by ? 'The amount depends on another choice (see More)' : undefined} onChange={(e) => patch({ amount: e.target.value.replace(/[^\d.-]/g, ''), unpriced: false, provisional: false })} /></div>
        <div className="min-w-[170px]">
          <label className="label" htmlFor={`cp-${i}-${j}`}>Charged</label>
          <select id={`cp-${i}-${j}`} className={cls} value={c.per ?? 'order'} onChange={(e) => patch({ per: e.target.value })}>
            {Object.entries(PER_TEXT).filter(([k]) => (k === 'sqft' || k === 'foot' ? ctx.mode === 'area' : k === 'position' ? positionsExist : true)).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </div>
        {kind === 'pick' && <label className="flex min-h-[44px] items-center gap-2 text-[14px]"><input type="radio" name={`def-${i}`} className={box} checked={o.defaultIndex === j} onChange={() => (o as any)._set({ defaultIndex: j })} />Starts as</label>}
        {kind === 'tick' && <label className="flex min-h-[44px] items-center gap-2 text-[14px]"><input type="checkbox" className={box} checked={(o.defaultIndexes ?? []).includes(j)} onChange={(e) => { const cur = new Set(o.defaultIndexes ?? []); if (e.target.checked) cur.add(j); else cur.delete(j); (o as any)._set({ defaultIndexes: [...cur] }); }} />Starts ticked</label>}
        {kind === 'split' && <div className="w-[90px]"><label className="label" htmlFor={`cc-${i}-${j}`}>Starts at</label><input id={`cc-${i}-${j}`} inputMode="numeric" className={cls} value={o.defaultCounts?.[j] ?? ''} placeholder="0" onChange={(e) => { const cur = [...(o.defaultCounts ?? [])]; cur[j] = e.target.value.replace(/\D/g, ''); (o as any)._set({ defaultCounts: cur }); }} /></div>}
        <div className="flex gap-1">
          <button type="button" className="btn-ghost btn-sm" aria-label={`Move ${c.label || 'this choice'} up`} disabled={j === 0} onClick={() => move(-1)}>Up</button>
          <button type="button" className="btn-ghost btn-sm" aria-label={`Move ${c.label || 'this choice'} down`} disabled={last} onClick={() => move(1)}>Down</button>
          <button type="button" className="btn-ghost btn-sm !text-bad" aria-label={`Remove ${c.label || 'this choice'}`} onClick={remove}>Remove</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {c.unpriced && !priced && (
          <>
            <span className="pill bg-warn-tint text-warn">Needs a price. Customers cannot see it yet.</span>
            <button type="button" className="underline" onClick={() => patch({ unpriced: false })}>It costs nothing extra: put it on sale</button>
          </>
        )}
        {c.provisional && <><span className="pill bg-warn-tint text-warn">Placeholder price</span><button type="button" className="underline" onClick={() => patch({ provisional: false })}>It is the real price</button></>}
        {c.hidden && <span className="pill bg-placeholder text-ink">Switched off</span>}
        {(c.amount && Number(c.amount) < 0) && <span className="pill bg-good-tint text-good">A saving</span>}
      </div>

      <details className="text-[14px]">
        <summary className="cursor-pointer font-bold text-muted">More: other charges, cost, rules{(c.setup || c.percent || c.by || c.cost || c.only_if || c.min_qty || c.max_qty || c.price_like) ? ' (set)' : ''}</summary>
        <div className="mt-3 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className="label" htmlFor={`cs-${i}-${j}`}>One-time setup charge (₦)</label><input id={`cs-${i}-${j}`} inputMode="decimal" className={cls} value={c.setup ?? ''} placeholder="0" onChange={(e) => patch({ setup: e.target.value.replace(/[^\d.]/g, ''), unpriced: false, provisional: false })} /></div>
            <div><label className="label" htmlFor={`cpc-${i}-${j}`}>Percentage of the price (%)</label><input id={`cpc-${i}-${j}`} inputMode="decimal" className={cls} value={c.percent ?? ''} placeholder="0" onChange={(e) => patch({ percent: e.target.value.replace(/[^\d.-]/g, ''), unpriced: false, provisional: false })} /></div>
            <div><label className="label" htmlFor={`cn-${i}-${j}`}>A note for customers</label><input id={`cn-${i}-${j}`} className={cls} maxLength={120} value={c.note ?? ''} onChange={(e) => patch({ note: e.target.value })} /></div>
          </div>
          <div className="grid gap-2 rounded-sm2 bg-paper2/60 p-3">
            <label className="label !mb-0" htmlFor={`cb-${i}-${j}`}>The extra depends on…</label>
            <select id={`cb-${i}-${j}`} className={`${cls} !w-auto`} value={dependsOn ?? ''} onChange={(e) => patch(e.target.value ? { by: { key: e.target.value, amounts: c.by?.key === e.target.value ? c.by.amounts : {} }, unpriced: c.unpriced } : { by: null })}>
              <option value="">Nothing: one amount</option>
              {ctx.mode === 'size' && <option value="size">The size</option>}
              {options.filter((x, n) => n !== i && x.key && (x.kind ?? 'pick') === 'pick').map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            {dependsOn && (
              <div className="flex flex-wrap gap-2">
                {byValues.map((v) => (
                  <label key={v.value} className="grid gap-1 text-[13px] font-bold text-muted">{v.label}
                    <input inputMode="decimal" className={`${cls} !w-[96px] !px-2`} value={c.by?.amounts[v.value] ?? ''} placeholder="₦" onChange={(e) => patch({ by: { key: dependsOn, amounts: { ...(c.by?.amounts ?? {}), [v.value]: e.target.value.replace(/[^\d.-]/g, '') } }, unpriced: false, provisional: false })} />
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor={`cco-${i}-${j}`}>What it costs us (₦, private)</label><input id={`cco-${i}-${j}`} inputMode="decimal" className={cls} value={c.cost ?? ''} placeholder="not entered" onChange={(e) => patch({ cost: e.target.value.replace(/[^\d.]/g, '') })} /></div>
            <div>
              <label className="label" htmlFor={`ccp-${i}-${j}`}>Cost is charged</label>
              <select id={`ccp-${i}-${j}`} className={cls} value={c.costPer ?? 'order'} onChange={(e) => patch({ costPer: e.target.value })}>
                {Object.entries(PER_TEXT).filter(([k]) => (k === 'sqft' || k === 'foot' ? ctx.mode === 'area' : k === 'position' ? positionsExist : true)).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </div>
          </div>
          <Cond label="Only offer this choice when…" value={c.only_if} onChange={(v) => patch({ only_if: v })} options={options} self={i} mode={ctx.mode} />
          <div className="grid gap-3 sm:grid-cols-4">
            <div><label className="label" htmlFor={`cmin-${i}-${j}`}>At least (pieces)</label><input id={`cmin-${i}-${j}`} inputMode="numeric" className={cls} value={c.min_qty ?? ''} onChange={(e) => patch({ min_qty: e.target.value.replace(/\D/g, '') })} /></div>
            <div><label className="label" htmlFor={`cmax-${i}-${j}`}>At most (pieces)</label><input id={`cmax-${i}-${j}`} inputMode="numeric" className={cls} value={c.max_qty ?? ''} onChange={(e) => patch({ max_qty: e.target.value.replace(/\D/g, '') })} /></div>
            {o.drives && (
              <div className="sm:col-span-2">
                <label className="label" htmlFor={`cl2-${i}-${j}`}>Uses the same prices as…</label>
                <select id={`cl2-${i}-${j}`} className={cls} value={c.price_like ?? ''} onChange={(e) => patch({ price_like: e.target.value })}>
                  <option value="">Its own price row</option>
                  {o.choices.filter((x, n) => n !== j && x.value && !x.price_like).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div><label className="label" htmlFor={`csw-${i}-${j}`}>Colour swatch</label><div className="flex items-center gap-2"><input id={`csw-${i}-${j}`} type="color" className="h-[44px] w-[56px] rounded-sm2 border-2 border-line-control" value={c.swatch || '#ffffff'} onChange={(e) => patch({ swatch: e.target.value })} />{c.swatch && <button type="button" className="text-[13px] underline" onClick={() => patch({ swatch: '' })}>none</button>}</div></div>
            <div><label className="label" htmlFor={`cw-${i}-${j}`}>Print width (in)</label><input id={`cw-${i}-${j}`} inputMode="decimal" className={cls} value={c.w_in ?? ''} onChange={(e) => patch({ w_in: e.target.value.replace(/[^\d.]/g, '') })} /></div>
            <div><label className="label" htmlFor={`ch-${i}-${j}`}>Print height (in)</label><input id={`ch-${i}-${j}`} inputMode="decimal" className={cls} value={c.h_in ?? ''} onChange={(e) => patch({ h_in: e.target.value.replace(/[^\d.]/g, '') })} /></div>
            <label className="flex min-h-[44px] items-center gap-2 self-end text-[14px]"><input type="checkbox" className={box} checked={!!c.hidden} onChange={(e) => patch({ hidden: e.target.checked })} />Switch off for now</label>
          </div>
        </div>
      </details>
    </div>
  );
}

// ---------- Options ----------
export function OptionsEditor({ id, initial, mode, sizes, action }: { id: string; initial: OptionIn[]; mode: Ctx['mode']; sizes: Ctx['sizes']; action: (fd: FormData) => void }) {
  const [opts, setOpts] = useState<OptionIn[]>(initial);
  const ctx: Ctx = { mode, sizes };
  const setOpt = (i: number, patch: Partial<OptionIn>) => setOpts((all) => all.map((o, n) => (n === i ? { ...o, ...patch } : o)));
  const setChoice = (i: number, j: number, patch: Partial<ChoiceIn>) => setOpts((all) => all.map((o, n) => (n === i ? { ...o, choices: o.choices.map((c, m) => (m === j ? { ...c, ...patch } : c)) } : o)));
  const moveOpt = (i: number, d: number) => setOpts((all) => { const j = i + d; if (j < 0 || j >= all.length) return all; const c = [...all]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const moveChoice = (i: number, j: number, d: number) => setOpts((all) => all.map((o, n) => {
    if (n !== i) return o;
    const k = j + d;
    if (k < 0 || k >= o.choices.length) return o;
    const ch = [...o.choices]; [ch[j], ch[k]] = [ch[k], ch[j]];
    const swap = <T,>(arr: T[] | undefined, fill: T): T[] | undefined => { if (!arr) return arr; const c2 = [...arr]; while (c2.length < o.choices.length) c2.push(fill); [c2[j], c2[k]] = [c2[k], c2[j]]; return c2; };
    return { ...o, choices: ch, defaultCounts: swap(o.defaultCounts, ''), defaultIndex: o.defaultIndex === j ? k : o.defaultIndex === k ? j : o.defaultIndex, defaultIndexes: o.defaultIndexes?.map((x) => (x === j ? k : x === k ? j : x)) };
  }));
  const removeChoice = (i: number, j: number) => setOpts((all) => all.map((o, n) => (n !== i ? o : {
    ...o,
    choices: o.choices.filter((_, m) => m !== j),
    defaultIndex: o.defaultIndex === j ? 0 : (o.defaultIndex ?? 0) > j ? (o.defaultIndex ?? 0) - 1 : o.defaultIndex,
    defaultIndexes: (o.defaultIndexes ?? []).filter((x) => x !== j).map((x) => (x > j ? x - 1 : x)),
    defaultCounts: (o.defaultCounts ?? []).filter((_, m) => m !== j),
  })));

  const payload = JSON.stringify(opts);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="json" value={payload} />
      {opts.length === 0 && <p className="text-muted">No options yet. Add one if customers should choose something, such as a finish or a paper.</p>}
      {opts.map((o, i) => {
        const kind = o.kind ?? 'pick';
        const waiting = o.choices.filter((c) => c.unpriced && !(c.amount || c.setup || c.percent)).length;
        const bound = { ...o, _set: (p: Partial<OptionIn>) => setOpt(i, p) } as OptionIn;
        return (
          <details key={o.key ?? `new-${i}`} open={!o.key || initial.length <= 3} className="rounded-md2 border border-line bg-paper2/50 p-4">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-[17px] font-bold">
              {o.label || 'New option'}
              <span className="pill bg-placeholder text-ink">{KIND_TEXT[kind]}</span>
              {o.drives && <span className="pill bg-accent text-ink">Changes the price table</span>}
              {o.special && <span className="pill bg-placeholder text-ink">Make it special</span>}
              {o.only_if && <span className="pill bg-placeholder text-ink">Only sometimes</span>}
              {waiting > 0 && <span className="pill bg-warn-tint text-warn">{waiting} need{waiting === 1 ? 's' : ''} a price</span>}
            </summary>
            <div className="mt-4 grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label" htmlFor={`on-${i}`}>What is it called?</label><input id={`on-${i}`} className={cls} value={o.label} maxLength={40} placeholder="Finish" onChange={(e) => setOpt(i, { label: e.target.value })} /></div>
                <div><label className="label" htmlFor={`oh-${i}`}>A hint for customers (optional)</label><input id={`oh-${i}`} className={cls} value={o.help ?? ''} maxLength={140} placeholder="Matt looks calm. Gloss looks bright." onChange={(e) => setOpt(i, { help: e.target.value })} /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label" htmlFor={`ok-${i}`}>How do customers choose?</label>
                  <select id={`ok-${i}`} className={cls} value={kind} onChange={(e) => setOpt(i, { kind: e.target.value, drives: e.target.value === 'pick' ? o.drives : false, positions: e.target.value === 'tick' ? o.positions : false })}>
                    <option value="pick">Choose one (Matte or Gloss)</option>
                    <option value="tick">Tick any (Rounded corners, Foil)</option>
                    <option value="split">A count of each (sizes S, M, L)</option>
                  </select>
                </div>
                <label className="flex min-h-[44px] items-center gap-2 self-end text-[14px]"><input type="checkbox" className={box} checked={!!o.special} onChange={(e) => setOpt(i, { special: e.target.checked })} />Tuck under &ldquo;Make it special&rdquo;</label>
                {kind === 'pick' && <label className="flex min-h-[44px] items-center gap-2 self-end text-[14px]"><input type="checkbox" className={box} checked={!!o.drives} onChange={(e) => setOpt(i, { drives: e.target.checked })} /><span>Each choice has its own prices <span className="text-muted">(a row in the price grid)</span></span></label>}
                {kind === 'tick' && <label className="flex min-h-[44px] items-center gap-2 self-end text-[14px]"><input type="checkbox" className={box} checked={!!o.positions} onChange={(e) => setOpt(i, { positions: e.target.checked })} /><span>These are print positions <span className="text-muted">(front, back, sleeve)</span></span></label>}
              </div>

              <Cond label="Show this option only when…" value={o.only_if} onChange={(v) => setOpt(i, { only_if: v })} options={opts} self={i} mode={mode} />

              <div className="grid gap-2">
                <p className="label !mb-0">Choices</p>
                {o.choices.map((c, j) => (
                  <ChoiceRow key={c.value ?? `n${j}`} c={c} j={j} o={bound} i={i} options={opts} ctx={ctx} patch={(p) => setChoice(i, j, p)} remove={() => removeChoice(i, j)} move={(d) => moveChoice(i, j, d)} last={j === o.choices.length - 1} />
                ))}
                {o.choices.length < 16 && <button type="button" className="btn-secondary btn-sm self-start" onClick={() => setOpt(i, { choices: [...o.choices, blankChoice()], defaultCounts: o.defaultCounts ? [...o.defaultCounts, ''] : o.defaultCounts })}>Add a choice</button>}
              </div>

              {kind === 'pick' && (
                <div className="grid gap-2">
                  <p className="label !mb-0">Choose by quantity (optional)</p>
                  <p className="text-[13px] text-muted">For options where the best choice depends on how many are ordered, such as heat transfer for a few shirts and screen print for many. Add a choice called &ldquo;Best for your quantity&rdquo; (its code must be <span className="font-mono">auto</span>) and set the steps here.</p>
                  {(o.auto ?? []).map((a, n) => (
                    <div key={n} className="flex flex-wrap items-end gap-2">
                      <div className="w-[120px]"><label className="label" htmlFor={`am-${i}-${n}`}>From (pieces)</label><input id={`am-${i}-${n}`} inputMode="numeric" className={cls} value={a.min_qty} onChange={(e) => setOpt(i, { auto: (o.auto ?? []).map((x, m) => (m === n ? { ...x, min_qty: e.target.value.replace(/\D/g, '') } : x)) })} /></div>
                      <div><label className="label" htmlFor={`av-${i}-${n}`}>use</label><select id={`av-${i}-${n}`} className={cls} value={a.value} onChange={(e) => setOpt(i, { auto: (o.auto ?? []).map((x, m) => (m === n ? { ...x, value: e.target.value } : x)) })}>{o.choices.filter((c) => c.value && c.value !== 'auto').map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
                      <button type="button" className="btn-ghost btn-sm !text-bad" onClick={() => setOpt(i, { auto: (o.auto ?? []).filter((_, m) => m !== n) })}>Remove</button>
                    </div>
                  ))}
                  {(o.auto ?? []).length > 0 || o.choices.some((c) => c.value === 'auto') ? <button type="button" className="btn-ghost btn-sm self-start" onClick={() => setOpt(i, { auto: [...(o.auto ?? []), { min_qty: '', value: o.choices.find((c) => c.value && c.value !== 'auto')?.value ?? '' }] })}>Add a step</button> : null}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-ghost btn-sm" disabled={i === 0} onClick={() => moveOpt(i, -1)}>Move up</button>
                <button type="button" className="btn-ghost btn-sm" disabled={i === opts.length - 1} onClick={() => moveOpt(i, 1)}>Move down</button>
                <button type="button" className="btn-ghost btn-sm !text-bad" onClick={() => { if (window.confirm(`Remove the ${o.label || 'new'} option? Its prices are kept as stray prices until you remove them in the price grid.`)) setOpts((all) => all.filter((_, n) => n !== i)); }}>Remove the {o.label || 'new'} option</button>
              </div>
            </div>
          </details>
        );
      })}
      <div className="flex flex-wrap gap-3">
        {opts.length < 24 && <button type="button" className="btn-secondary btn-sm" onClick={() => setOpts((all) => [...all, blankOption()])}>Add an option</button>}
        <button className="btn-primary btn-sm">Save options</button>
      </div>
      <p className="text-[13px] text-muted">An extra is added to the price. Leave it empty for no extra, or use a minus for a saving (one side instead of two). Nothing here reaches customers until you press Save options.</p>
    </form>
  );
}

// ---------- Packages ----------
export function PackagesEditor({ id, initial, options, action }: { id: string; initial: PackageForm[]; options: OptionIn[]; action: (fd: FormData) => void }) {
  const [pk, setPk] = useState<PackageForm[]>(initial);
  const set = (i: number, patch: Partial<PackageForm>) => setPk((all) => all.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  const usable = options.filter((o) => o.key && (o.kind ?? 'pick') !== 'split');
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="json" value={JSON.stringify(pk)} />
      {pk.length === 0 && <p className="text-muted">No packages. Packages give customers one tap for a good combination: Standard, Premium, Luxury.</p>}
      {pk.map((p, i) => (
        <fieldset key={p.key ?? `n${i}`} className="grid gap-3 rounded-md2 border border-line bg-paper2/50 p-4">
          <legend className="sr-only">Package {i + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className="label" htmlFor={`pl-${i}`}>Name</label><input id={`pl-${i}`} className={cls} value={p.label} maxLength={24} placeholder="Premium" onChange={(e) => set(i, { label: e.target.value })} /></div>
            <div><label className="label" htmlFor={`pt-${i}`}>One line about it</label><input id={`pt-${i}`} className={cls} value={p.tagline} maxLength={70} placeholder="350gsm card, matte lamination" onChange={(e) => set(i, { tagline: e.target.value })} /></div>
            <div><label className="label" htmlFor={`pb-${i}`}>Badge (optional)</label><input id={`pb-${i}`} className={cls} value={p.badge} maxLength={18} placeholder="Most popular" onChange={(e) => set(i, { badge: e.target.value })} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {usable.map((o) => {
              const kind = o.kind ?? 'pick';
              const cur = p.set[o.key!];
              return (
                <div key={o.key}>
                  <p className="label">{o.label}</p>
                  {kind === 'pick' ? (
                    <select aria-label={`${p.label || 'Package'}: ${o.label}`} className={cls} value={cur ?? ''} onChange={(e) => { const s = { ...p.set }; if (e.target.value === '') delete s[o.key!]; else s[o.key!] = e.target.value; set(i, { set: s }); }}>
                      <option value="">Leave as the customer chose</option>
                      {o.choices.filter((c) => c.value).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  ) : (
                    <div className="grid gap-1">
                      <label className="inline-flex min-h-[40px] items-center gap-2 text-[14px]"><input type="checkbox" className={box} checked={cur !== undefined} onChange={(e) => { const s = { ...p.set }; if (e.target.checked) s[o.key!] = ''; else delete s[o.key!]; set(i, { set: s }); }} />Set the ticks</label>
                      {cur !== undefined && (
                        <div className="flex flex-wrap gap-x-3">
                          {o.choices.filter((c) => c.value).map((c) => (
                            <label key={c.value} className="inline-flex min-h-[40px] items-center gap-1.5 text-[14px]"><input type="checkbox" className={box} checked={cur.split(',').includes(c.value!)} onChange={(e) => { const sel = new Set(cur.split(',').filter(Boolean)); if (e.target.checked) sel.add(c.value!); else sel.delete(c.value!); set(i, { set: { ...p.set, [o.key!]: o.choices.map((x) => x.value!).filter((v) => sel.has(v)).join(',') } }); }} />{c.label}</label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost btn-sm" disabled={i === 0} onClick={() => setPk((all) => { const c = [...all]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c; })}>Move up</button>
            <button type="button" className="btn-ghost btn-sm" disabled={i === pk.length - 1} onClick={() => setPk((all) => { const c = [...all]; [c[i + 1], c[i]] = [c[i], c[i + 1]]; return c; })}>Move down</button>
            <button type="button" className="btn-ghost btn-sm !text-bad" onClick={() => setPk((all) => all.filter((_, n) => n !== i))}>Remove this package</button>
          </div>
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-3">
        {pk.length < 4 && <button type="button" className="btn-secondary btn-sm" onClick={() => setPk((all) => [...all, { label: '', tagline: '', badge: '', set: {} }])}>Add a package</button>}
        <button className="btn-primary btn-sm">Save packages</button>
      </div>
      <p className="text-[13px] text-muted">A package is shown only when every choice in it is on sale and priced, so a package never promises something a customer cannot get. Its price is worked out from the choices, never typed in.</p>
    </form>
  );
}

// ---------- Sizes ----------
type SizeRowT = { key?: string; label: string; w: string; h: string };
export function SizesEditor({ id, initial, action }: { id: string; initial: SizeRowT[]; action: (fd: FormData) => void }) {
  const [rows, setRows] = useState<SizeRowT[]>(initial);
  const set = (i: number, patch: Partial<SizeRowT>) => setRows((all) => all.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => setRows((all) => { const j = i + d; if (j < 0 || j >= all.length) return all; const c = [...all]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="json" value={JSON.stringify(rows.map((r) => ({ key: r.key, label: r.label, w_in: r.w, h_in: r.h })))} />
      {rows.map((r, i) => (
        <div key={r.key ?? `n${i}`} className="grid grid-cols-2 gap-2 rounded-md2 border border-line bg-paper2/50 p-3 sm:grid-cols-[1fr_100px_100px_auto] sm:items-end">
          <div className="col-span-2 sm:col-span-1"><label className="label" htmlFor={`sl-${i}`}>Size name</label><input id={`sl-${i}`} className={cls} value={r.label} maxLength={50} placeholder="A4" onChange={(e) => set(i, { label: e.target.value })} /></div>
          <div><label className="label" htmlFor={`sw-${i}`}>Width (in)</label><input id={`sw-${i}`} inputMode="decimal" className={cls} value={r.w} placeholder="8.3" onChange={(e) => set(i, { w: e.target.value.replace(/[^\d.]/g, '') })} /></div>
          <div><label className="label" htmlFor={`sh-${i}`}>Height (in)</label><input id={`sh-${i}`} inputMode="decimal" className={cls} value={r.h} placeholder="11.7" onChange={(e) => set(i, { h: e.target.value.replace(/[^\d.]/g, '') })} /></div>
          <div className="col-span-2 flex gap-1 sm:col-span-1">
            <button type="button" className="btn-ghost btn-sm" disabled={i === 0} onClick={() => move(i, -1)}>Up</button>
            <button type="button" className="btn-ghost btn-sm" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>Down</button>
            <button type="button" className="btn-ghost btn-sm !text-bad" aria-label={`Remove ${r.label || 'size'}`} onClick={() => { if (!r.key || window.confirm(`Remove ${r.label || 'this size'}? Its prices are deleted when you press Save sizes.`)) setRows((all) => all.filter((_, n) => n !== i)); }}>Remove</button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-3">
        {rows.length < 12 && <button type="button" className="btn-secondary btn-sm" onClick={() => setRows((all) => [...all, { label: '', w: '', h: '' }])}>Add a size</button>}
        <button className="btn-primary btn-sm">Save sizes</button>
      </div>
      <p className="text-[13px] text-muted">Keep sizes in order from smallest to largest. The width and height let us warn a customer when their file is too small to print sharply. Prices for each size go in the price grid.</p>
    </form>
  );
}
