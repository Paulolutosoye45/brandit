'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { confirmCode, requestCode } from '@/app/(auth)/actions';
import { OtpInput } from '@/components/OtpInput';
import { GoogleIcon } from '@/components/GoogleIcon';
import { Check, Notice } from '@/components/Bits';
import { suggestEmail } from '@/lib/emailTypos';
import { maskIdentifier } from '@/lib/phoneFormat';
import { useT } from '@/components/LangProvider';

type Methods = { google: boolean; email: boolean; demo: boolean };

/**
 * Signing in happens right here, in the middle of checkout, so nobody is sent away and then has to find their way back.
 * A verified email code or Google. The page behind refreshes when it works, and the form below fills itself in.
 */
export function CheckoutSignIn({ methods, next }: { methods: Methods; next: string }) {
  const tr = useT();
  const router = useRouter();
  const [step, setStep] = useState<'start' | 'code'>('start');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [done, setDone] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const typo = step === 'start' ? suggestEmail(email) : null;

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function send() {
    setBusy(true); setErr(null);
    const r = await requestCode('email', email);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setIdentifier(r.identifier); setDemoCode(r.demoCode ?? null); setCode(''); setCooldown(30); setStep('code');
  }

  async function verify(c: string) {
    setBusy(true); setErr(null);
    const r = await confirmCode('email', identifier, c, next);
    if (!r.ok) { setBusy(false); setErr(r.error); setCode(''); setShake((n) => n + 1); return; }
    setDone(true);
    router.refresh();
  }
  const onCode = (v: string) => { setCode(v); if (v.length === 6 && !busy && !done) verify(v); };

  return (
    <section id="signin" className="card grid gap-4 p-5" aria-labelledby="signin-h">
      <div>
        <h2 id="signin-h" className="text-[22px]">{tr('Sign in to pay')}</h2>
        <p className="mt-1 text-[14px] text-muted">{tr('It takes a few seconds. Your basket stays as it is, and your orders stay in one place.')}</p>
      </div>

      {step === 'code' ? (
        <div className="grid gap-4">
          <p className="text-[16px]">
            {tr('We sent a six-digit code to')} <span className="font-bold">{maskIdentifier('email', identifier)}</span>.{' '}
            <button type="button" className="link" onClick={() => { setStep('start'); setErr(null); setCode(''); }}>{tr('Wrong email?')}</button>
          </p>
          {demoCode && (
            <Notice tone="warn"><span className="font-bold">Demo mode.</span> Your code is <span className="font-display text-[22px] font-extrabold tracking-[0.2em]">{demoCode}</span>{' '}<button type="button" className="link ml-1" onClick={() => onCode(demoCode)}>Fill it in</button></Notice>
          )}
          <OtpInput value={code} onChange={onCode} disabled={busy || done} shake={shake > 0} key={shake} invalid={!!err} />
          <div aria-live="polite" className="min-h-[24px] text-[15px]">
            {err && <p role="alert" className="font-bold text-bad">{err}</p>}
            {busy && !err && !done && <p className="text-muted">{tr('Checking your code…')}</p>}
            {done && <p className="flex items-center gap-2 font-bold text-good"><span className="grid h-5 w-5 place-items-center rounded-full bg-good text-white"><Check className="h-3 w-3" /></span>{tr('Signed in.')}</p>}
          </div>
          <div className="text-[15px]">
            {cooldown > 0 ? <p className="text-muted">{tr('Send a new code in {n}s', { n: cooldown })}</p> : <button type="button" className="link" disabled={busy} onClick={send}>{tr('Send a new code')}</button>}
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {err && <Notice tone="bad">{err}</Notice>}
          {methods.google && (
            <a href={`/api/auth/google?next=${encodeURIComponent(next)}`} className="btn w-full border-2 border-line-control bg-surface text-ink hover:border-ink hover:bg-paper active:translate-y-px">
              <GoogleIcon /> {tr('Continue with Google')}
            </a>
          )}
          {methods.google && methods.email && (
            <div className="flex items-center gap-4 text-[14px] text-muted" role="separator" aria-label="or"><span className="h-px flex-1 bg-line" />{tr('or use your email')}<span className="h-px flex-1 bg-line" /></div>
          )}
          {methods.email && (
            // This sits inside the checkout form, and a form cannot hold a form: so no <form> here. Enter sends the code, and the button is not a submit button.
            <div className="grid gap-3">
              <div>
                <label htmlFor="co-email" className="label">{tr('Email address')}</label>
                <input id="co-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="you@example.com" className="field" value={email} onChange={(e) => { setEmail(e.target.value); if (err) setErr(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!busy && email.includes('@')) void send(); } }} />
                {typo && <p className="mt-2 text-[14px]">{tr('Did you mean')} <button type="button" className="link" onClick={() => setEmail(typo)}>{typo}</button>?</p>}
              </div>
              <button type="button" className="btn-primary" disabled={busy || !email.includes('@')} onClick={() => void send()}>{busy ? tr('Sending code…') : tr('Send me a code')}</button>
            </div>
          )}
          <p className="text-[13px] leading-snug text-muted">
            {tr('By continuing you agree to our')} <Link href="/legal/terms" className="underline underline-offset-2 hover:text-ink">{tr('Terms')}</Link> {tr('and')} <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-ink">{tr('Privacy Policy')}</Link>.
          </p>
        </div>
      )}
    </section>
  );
}
