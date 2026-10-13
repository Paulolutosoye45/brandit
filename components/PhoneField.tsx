'use client';
import { formatLocal } from '@/lib/phoneFormat';

/** A Nigerian mobile number: +234 is fixed, the person types or pastes the rest in any common form. */
export function PhoneField({ id, value, onChange, invalid, autoFocus, describedBy }: { id: string; value: string; onChange: (v: string) => void; invalid?: boolean; autoFocus?: boolean; describedBy?: string }) {
  return (
    <div className="flex">
      <span className="inline-flex min-h-[48px] items-center rounded-l-sm2 border-2 border-r-0 border-line-control bg-paper2 px-3.5 font-bold text-muted select-none">+234</span>
      <input
        id={id} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="803 123 4567" autoFocus={autoFocus}
        value={value} onChange={(e) => onChange(formatLocal(e.target.value))}
        aria-invalid={invalid} aria-describedby={describedBy}
        className="field !rounded-l-none tabular"
      />
    </div>
  );
}
