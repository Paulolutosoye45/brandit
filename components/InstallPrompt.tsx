'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { countVisit, useInstall } from './useInstall';
import { useT } from './LangProvider';

/**
 * A small, polite offer to add Brandit to the home screen. It waits until someone has come back, or has an order,
 * and asks again no sooner than a month after "Not now". On an iPhone it shows the two taps, since Safari has no button for it.
 */
export function InstallPrompt() {
  const t = useT();
  const path = usePathname() ?? '/';
  const { available, canPrompt, snoozed, install, snooze } = useInstall();
  const [visits, setVisits] = useState(0);
  const [howTo, setHowTo] = useState(false);
  useEffect(() => { setVisits(countVisit()); }, []);

  const quiet = /^\/(checkout|pay|console|rider|signin|proof)/.test(path);
  const engaged = visits >= 2 || /^\/(track|order)/.test(path);
  if (!available || snoozed || quiet || !engaged) return null;

  return (
    <aside aria-label={t('Add Brandit to your home screen')} className="fixed inset-x-3 bottom-[72px] z-30 md:hidden">
      <div className="rounded-lg2 border-2 border-ink bg-surface p-4 shadow-press">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-md2" />
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-bold leading-tight">{t('Add Brandit to your home screen')}</p>
            <p className="text-[14px] text-muted">{t('Track your order and reorder in one tap, like an app.')}</p>
          </div>
        </div>
        {howTo && (
          <ol className="mt-3 grid gap-1.5 rounded-md2 bg-paper2 p-3 text-[15px]">
            <li>{t('1. Tap the Share button at the bottom of Safari.')}</li>
            <li>{t('2. Tap “Add to Home Screen”, then “Add”.')}</li>
          </ol>
        )}
        <div className="mt-3 flex gap-2">
          {canPrompt ? (
            <button type="button" className="btn-primary btn-sm flex-1" onClick={() => install()}>{t('Add to home screen')}</button>
          ) : (
            <button type="button" className="btn-primary btn-sm flex-1" onClick={() => setHowTo((v) => !v)} aria-expanded={howTo}>{howTo ? t('Got it') : t('Show me how')}</button>
          )}
          <button type="button" className="btn-ghost btn-sm" onClick={() => snooze(30)}>{t('Not now')}</button>
        </div>
      </div>
    </aside>
  );
}

/** A plain button for the account page, for anyone who dismissed the prompt earlier. */
export function InstallButton() {
  const t = useT();
  const { available, canPrompt, install } = useInstall();
  const [howTo, setHowTo] = useState(false);
  if (!available) return null;
  return (
    <div className="grid gap-2">
      <button type="button" className="btn-secondary btn-sm self-start" onClick={() => (canPrompt ? install() : setHowTo((v) => !v))}>{t('Add Brandit to your home screen')}</button>
      {howTo && <p className="rounded-md2 bg-paper2 p-3 text-[15px]">{t('1. Tap the Share button at the bottom of Safari.')} {t('2. Tap “Add to Home Screen”, then “Add”.')}</p>}
    </div>
  );
}
