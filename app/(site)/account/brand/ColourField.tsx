'use client';
import { useState } from 'react';

/** A colour picker and a hex box that stay in step. The box can be emptied to mean "no colour". */
export function ColourField({ id, name, label, initial }: { id: string; name: string; label: string; initial: string | null }) {
  const [hex, setHex] = useState(initial ?? '');
  const valid = /^#?[0-9a-fA-F]{6}$/.test(hex.trim());
  const pick = valid ? (hex.startsWith('#') ? hex : `#${hex}`) : '#0B1F33';
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${label} colour picker`} value={pick} onChange={(e) => setHex(e.target.value.toUpperCase())} className="h-12 w-14 shrink-0 cursor-pointer rounded-sm2 border-2 border-line-control bg-white p-1" />
        <input id={id} name={name} value={hex} onChange={(e) => setHex(e.target.value)} placeholder="#0B1F33" maxLength={7} autoComplete="off" spellCheck={false} className="field font-mono uppercase" />
      </div>
    </div>
  );
}
