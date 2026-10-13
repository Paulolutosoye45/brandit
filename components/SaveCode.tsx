'use client';
import { useEffect, useState } from 'react';
import { useT } from './LangProvider';

const KEY = 'brandit.coupon';

/** Keeps a code on this phone for two weeks, the same way a shared link does, so it is taken off at checkout. */
export function SaveCode({ code }: { code: string }) {
  const t = useT();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (s?.code === code && Date.now() - s.at < 14 * 86_400_000) setSaved(true); } catch { /* none */ }
  }, [code]);
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() })); setSaved(true); } catch { setSaved(true); }
  }
  return saved
    ? <p role="status" className="font-bold">{t('Saved. We take it off at checkout.')}</p>
    : <button type="button" onClick={save} className="btn-dark btn-sm">{t('Use this code')}</button>;
}
