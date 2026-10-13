'use client';
import { useEffect, useRef } from 'react';

/** One door to the server for everything a customer does to a design. Never throws: failures come back as { ok: false, error }. */
export type Reply = { ok: boolean; error?: string; code?: string; field?: string; status: number; [k: string]: any };
export async function act(id: string, body: Record<string, unknown>): Promise<Reply> {
  try {
    const res = await fetch(`/api/studio/projects/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => null);
    if (!j) return { ok: false, status: res.status, error: 'Something went wrong. Please try again.' };
    return { ...j, status: res.status };
  } catch {
    return { ok: false, status: 0, error: 'We could not reach Brandit. Check your connection and try again.' };
  }
}
export async function post(url: string, body: Record<string, unknown>): Promise<Reply> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => null);
    if (!j) return { ok: false, status: res.status, error: 'Something went wrong. Please try again.' };
    return { ...j, status: res.status };
  } catch {
    return { ok: false, status: 0, error: 'We could not reach Brandit. Check your connection and try again.' };
  }
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} animate-spin`} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Calls fn every `ms` while `on`. */
export function useEvery(fn: () => void, ms: number, on: boolean) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms, on]);
}

export const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;

export function Toast({ tone, children }: { tone: 'good' | 'bad' | 'warn' | 'neutral'; children: React.ReactNode }) {
  const cls = { good: 'bg-good-tint', warn: 'bg-warn-tint', bad: 'bg-bad-tint', neutral: 'bg-placeholder' }[tone];
  return <div role={tone === 'bad' ? 'alert' : 'status'} className={`rounded-md2 px-4 py-3 text-[15px] text-ink ${cls}`}>{children}</div>;
}

export function StatusIcon({ status }: { status: string }) {
  if (status === 'pass') return <span aria-label="Good" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-good text-white"><svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>;
  if (status === 'warn') return <span aria-label="Note" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-warn text-white text-[14px] font-extrabold">!</span>;
  return <span aria-label="Problem" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bad text-white text-[14px] font-extrabold">×</span>;
}
