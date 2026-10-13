'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { confirmCode, requestCode } from '../actions';
import { OtpInput } from '@/components/OtpInput';
import { PhoneField } from '@/components/PhoneField';
import { GoogleIcon } from '@/components/GoogleIcon';
import { Check, Notice } from '@/components/Bits';
import { suggestEmail } from '@/lib/emailTypos';
import { maskIdentifier, toE164 } from '@/lib/phoneFormat';

type Channel = 'email' | 'phone';
type Methods = { google: boolean; email: boolean; phone: boolean; demo: boolean };

const LAST_KEY = 'brandit.lastAuth';

export function SignInFlow({ methods, next, initialError }: { methods: Methods; next: string; initialError?: string }) {
  const router = useRouter();
  const phoneOnly = methods.phone && !methods.email && !methods.google;
  const [step, setStep] = useState<'start' | 'phone' | 'code'>(phoneOnly ? 'phone' : 'start');
  const [channel, setChannel] = useState<Channel>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [done, setDone] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => { setLast(localStorage.getItem(LAST_KEY)); }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Android can read the code from the text message and hand it over.
  useEffect(() => {
    if (step !== 'code' || channel !== 'phone' || !('OTPCredential' in window)) return;
    const ac = new AbortController();
    (navigator.credentials as any).get({ otp: { transport: ['sms'] }, signal: ac.signal }).then((o: any) => o?.code && setCode(o.code)).catch(() => {});
    return () => ac.abort();
  }, [step, channel]);

  const typo = channel === 'email' && step === 'start' ? suggestEmail(email) : null;

  async function send(ch: Channel) {
    setBusy(true); setErr(null);
    const r = await requestCode(ch, ch === 'email' ? email : toE164(phone));
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setChannel(ch); setIdentifier(r.identifier); setDemoCode(r.demoCode ?? null); setCode(''); setCooldown(30); setStep('code');
  }

  async function verify(c: string) {
    setBusy(true); setErr(null);
    const r = await confirmCode(channel, identifier, c, next);
    if (!r.ok) { setBusy(false); setErr(r.error); setCode(''); setShake((n) => n + 1); return; }
    localStorage.setItem(LAST_KEY, channel);
    setDone(true);
    router.replace(r.to);
    router.refresh();
  }

  function onCode(v: string) {
    setCode(v);
    if (v.length === 6 && !busy && !done) verify(v);
  }

  const lastBadge = (m: string) => (last === m ? <span className="ml-1 rounded-full bg-accent px-2 py-0.5 text-[12px] font-bold text-ink">Last used</span> : null);

  // ---------- Step 2: the code ----------
  if (step === 'code') {
    return (
      <div className="grid w-full max-w-[420px] gap-6">
        <div className="grid gap-2">
          <h1 className="text-[34px] leading-[1.05]">{channel === 'email' ? 'Check your email' : 'Check your messages'}</h1>
          <p className="text-[17px] text-muted">
            We sent a six-digit code to <span className="font-bold text-ink">{maskIdentifier(channel, identifier)}</span>.{' '}
            <button type="button" className="link" onClick={() => { setStep(channel === 'phone' && !methods.email ? 'phone' : 'start'); setErr(null); setCode(''); }}>
              {channel === 'email' ? 'Wrong email?' : 'Wrong number?'}
            </button>
          </p>
        </div>

        {demoCode && (
          <Notice tone="warn">
            <span className="font-bold">Demo mode.</span> Your code is <span className="font-display text-[22px] font-extrabold tracking-[0.2em]">{demoCode}</span>{' '}
            <button type="button" className="link ml-1" onClick={() => onCode(demoCode)}>Fill it in</button>
          </Notice>
        )}

        <div className="grid gap-3">
          <OtpInput value={code} onChange={onCode} disabled={busy || done} shake={shake > 0} key={shake} invalid={!!err} />
          <div aria-live="polite" className="min-h-[24px] text-[15px]">
            {err && <p role="alert" className="font-bold text-bad">{err}</p>}
            {busy && !err && <p className="text-muted">Checking your code…</p>}
            {done && <p className="flex items-center gap-2 font-bold text-good"><span className="grid h-5 w-5 animate-pop place-items-center rounded-full bg-good text-white"><Check className="h-3 w-3" /></span>Signed in. Taking you there…</p>}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 text-[15px]">
          {cooldown > 0 ? (
            <p className="text-muted">Send a new code in {cooldown}s</p>
          ) : (
            <button type="button" className="link" disabled={busy} onClick={() => send(channel)}>Send a new code</button>
          )}
          {channel === 'email' && methods.phone && <button type="button" className="link" onClick={() => { setStep('phone'); setErr(null); }}>Use my phone</button>}
        </div>
        {channel === 'email' && <p className="text-[14px] text-muted">Nothing there? Check your spam folder. The code works for 10 minutes.</p>}
      </div>
    );
  }

  // ---------- Step 1b: phone ----------
  if (step === 'phone') {
    return (
      <form className="grid w-full max-w-[420px] gap-6" onSubmit={(e) => { e.preventDefault(); send('phone'); }}>
        <div className="grid gap-2">
          <h1 className="text-[34px] leading-[1.05]">Use your phone number</h1>
          <p className="text-[17px] text-muted">We will text you a six-digit code. No password needed.</p>
        </div>
        {err && <Notice tone="bad">{err}</Notice>}
        <div>
          <label htmlFor="phone" className="label">Mobile number</label>
          <PhoneField id="phone" value={phone} onChange={setPhone} autoFocus invalid={!!err} />
          <p className="mt-2 text-[14px] text-muted">Works with any Nigerian network. Standard SMS rates may apply.</p>
        </div>
        <button className="btn-primary" disabled={busy || phone.replace(/\D/g, '').length < 10}>{busy ? 'Sending…' : 'Send me a code'}</button>
        {!phoneOnly && <button type="button" className="link justify-self-start" onClick={() => { setStep('start'); setErr(null); }}>Use Google or email instead</button>}
      </form>
    );
  }

  // ---------- Nothing is set up yet: say so, and do not leave anyone stuck ----------
  if (!methods.google && !methods.email && !methods.phone) {
    return (
      <div className="grid w-full max-w-[420px] gap-6">
        <div className="grid gap-2">
          <h1 className="text-[34px] leading-[1.05]">Sign-in is not available right now</h1>
          <p className="text-[17px] text-muted">You do not need an account to order. Choose what you need, pay as a guest, and track it with your order code.</p>
        </div>
        <div className="flex flex-wrap gap-3"><Link href="/products" className="btn-primary">Start your order</Link><Link href="/track" className="btn-secondary">Track an order</Link></div>
      </div>
    );
  }

  // ---------- Step 1: choose ----------
  const onlyGoogle = methods.google && !methods.email;
  return (
    <div className="grid w-full max-w-[420px] gap-7">
      <div className="grid gap-2">
        <h1 className="text-[34px] leading-[1.05] sm:text-[38px]">Sign in or create your account</h1>
        <p className="text-[17px] text-muted">One account for your orders, receipts and reorders. No password to remember.</p>
      </div>

      {err && <Notice tone="bad">{err}</Notice>}

      {methods.google && (
        <a
          href={`/api/auth/google?next=${encodeURIComponent(next)}`}
          onClick={() => localStorage.setItem(LAST_KEY, 'google')}
          className="btn bg-surface text-ink border-2 border-line-control hover:border-ink hover:bg-paper active:translate-y-px w-full"
        >
          <GoogleIcon /> Continue with Google{lastBadge('google')}
        </a>
      )}

      {methods.google && methods.email && (
        <div className="flex items-center gap-4 text-[14px] text-muted" role="separator" aria-label="or">
          <span className="h-px flex-1 bg-line" />or use your email<span className="h-px flex-1 bg-line" />
        </div>
      )}

      {methods.email && (
        <form className="grid gap-3.5" onSubmit={(e) => { e.preventDefault(); send('email'); }} noValidate>
          <div>
            <label htmlFor="email" className="label">Email address{lastBadge('email')}</label>
            <input
              id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              placeholder="you@example.com" className="field" value={email} aria-invalid={!!err && channel === 'email'}
              onChange={(e) => { setEmail(e.target.value); if (err) setErr(null); }}
            />
            {typo && (
              <p className="mt-2 text-[14px]">
                Did you mean <button type="button" className="link" onClick={() => setEmail(typo)}>{typo}</button>?
              </p>
            )}
          </div>
          <button className="btn-primary" disabled={busy || !email.includes('@')}>{busy ? 'Sending code…' : 'Continue with email'}</button>
        </form>
      )}

      {methods.phone && (
        <button type="button" className="justify-self-center text-[15px] text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => { setStep('phone'); setErr(null); }}>
          Use your phone number instead{lastBadge('phone')}
        </button>
      )}

      {onlyGoogle && <p className="text-[14px] text-muted">We only see your name and email. We never post anything.</p>}

      <p className="text-center text-[13px] leading-snug text-muted">
        By continuing you agree to our <Link href="/legal/terms" className="underline underline-offset-2 hover:text-ink">Terms</Link> and <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-ink">Privacy Policy</Link>.
      </p>
    </div>
  );
}
