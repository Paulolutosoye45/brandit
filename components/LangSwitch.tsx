'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from './LangProvider';

/** Two small buttons: English or Pidgin. Remembers the choice on this phone, and on the account when signed in. */
export function LangSwitch({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const lang = useLang();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function pick(next: 'en' | 'pcm') {
    if (next === lang || busy) return;
    setBusy(true);
    try {
      await fetch('/api/lang', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: next }) });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  const on = tone === 'dark' ? 'bg-accent text-ink' : 'bg-ink text-white';
  const off = tone === 'dark' ? 'text-on-ink-muted hover:text-white' : 'text-muted hover:text-ink';
  return (
    <div role="group" aria-label="Language" className="inline-flex items-center gap-1 rounded-full border border-current/30 p-1 text-[14px]">
      {([['en', 'English'], ['pcm', 'Pidgin']] as const).map(([k, label]) => (
        <button key={k} type="button" onClick={() => pick(k)} aria-pressed={lang === k} disabled={busy} className={`min-h-[36px] rounded-full px-3 font-bold ${lang === k ? on : off}`}>{label}</button>
      ))}
    </div>
  );
}
