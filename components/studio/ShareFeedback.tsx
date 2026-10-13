'use client';
import { useState } from 'react';
import { Toast, post } from './ui';

export function ShareFeedback({ token }: { token: string }) {
  const [name, setName] = useState('');
  const [verdict, setVerdict] = useState<'like' | 'changes' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  async function send() {
    setBusy(true); setErr(null);
    const r = await post(`/api/studio/share/${encodeURIComponent(token)}`, { name, verdict, note });
    if (r.ok) setSent(true); else setErr(r.error ?? 'Something went wrong. Try again.');
    setBusy(false);
  }
  if (sent) return <Toast tone="good">Thank you. Your answer has been sent.</Toast>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); send(); }} className="card grid gap-4 p-5">
      <div>
        <label className="label" htmlFor="fb-name">Your name</label>
        <input id="fb-name" className="field" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" placeholder="So they know who it is from" />
      </div>
      <div role="radiogroup" aria-label="What do you think?" className="grid gap-2 sm:grid-cols-2">
        {([['like', 'I like it'], ['changes', 'Please change something']] as const).map(([id, label]) => (
          <label key={id} className={`flex min-h-[52px] cursor-pointer items-center justify-center rounded-md2 border-2 px-4 text-center font-bold ${verdict === id ? 'border-ink bg-ink text-white' : 'border-line-control hover:border-ink'}`}>
            <input type="radio" name="verdict" className="sr-only" checked={verdict === id} onChange={() => setVerdict(id)} />{label}
          </label>
        ))}
      </div>
      {verdict === 'changes' && (
        <div>
          <label className="label" htmlFor="fb-note">What should change?</label>
          <textarea id="fb-note" className="field py-3" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: the date is wrong, or make it less busy" />
        </div>
      )}
      {err && <Toast tone="bad">{err}</Toast>}
      <button className="btn-primary" disabled={busy || !name.trim() || !verdict}>{busy ? 'Sending…' : 'Send my answer'}</button>
    </form>
  );
}
