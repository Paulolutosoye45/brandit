'use client';
import { useState } from 'react';

/** Copies text to the clipboard. On a phone that blocks it, the text is shown to copy by hand. */
export function CopyButton({ text, label = 'Copy', className = 'btn-secondary btn-sm' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { window.prompt('Copy this:', text); }
      }}
    >{done ? 'Copied' : label}</button>
  );
}
