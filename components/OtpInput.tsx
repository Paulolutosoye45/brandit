'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Six boxes you see, one real input you type into. Because it is one input, paste works, the phone's
 * "fill code from message" works, and backspace behaves. Nothing to tab between.
 */
export function OtpInput({ value, onChange, disabled, shake, autoFocus = true, invalid }: { value: string; onChange: (v: string) => void; disabled?: boolean; shake?: boolean; autoFocus?: boolean; invalid?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  const active = Math.min(value.length, 5);
  return (
    <div className={`relative ${shake ? 'animate-shake' : ''}`} onClick={() => ref.current?.focus()}>
      <div className="grid grid-cols-6 gap-2.5" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => {
          const ch = value[i];
          const on = focused && i === active && !disabled;
          return (
            <div key={i} className={`h-[60px] rounded-sm2 border-2 grid place-items-center font-display text-[30px] font-extrabold bg-surface tabular transition-[border-color,box-shadow] duration-100 ${invalid ? 'border-bad' : on ? 'border-ink shadow-focus' : ch ? 'border-ink' : 'border-line-control'} ${disabled ? 'opacity-60' : ''}`}>
              {ch ?? (on ? <span className="h-7 w-[2px] bg-ink animate-pulse" /> : null)}
            </div>
          );
        })}
      </div>
      <input
        ref={ref} value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" aria-label="Six-digit code"
        className="absolute inset-0 h-full w-full cursor-text opacity-0 text-[16px]"
      />
    </div>
  );
}
