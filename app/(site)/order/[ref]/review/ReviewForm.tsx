'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Notice } from '@/components/Bits';

/** The review form. The photo is shown before it is sent, and it stays private until a person at Brandit checks it. */
export function ReviewForm({ token }: { token: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!photo) { setPreview(null); return; } const u = URL.createObjectURL(photo); setPreview(u); return () => URL.revokeObjectURL(u); }, [photo]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!rating) { setErr({ message: 'Choose a rating from 1 to 5.', field: 'rating' }); return; }
    setBusy(true); setErr(null);
    const fd = new FormData(e.currentTarget);
    fd.set('rating', String(rating));
    if (photo) fd.set('photo', photo); else fd.delete('photo');
    try {
      const res = await fetch(`/api/reviews/${token}`, { method: 'POST', body: fd });
      const d = await res.json().catch(() => null);
      if (!d?.ok) { setErr({ message: d?.error || 'That did not send. Try again.', field: d?.field }); setBusy(false); return; }
      router.push(`/track/${token}?reviewed=${d.hasPhoto ? 'photo' : '1'}`);
    } catch {
      setErr({ message: 'That did not send. Check your connection and try again.' });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card grid gap-5 p-6">
      {err && <Notice tone="bad">{err.message}</Notice>}
      <fieldset>
        <legend className="label">Your rating</legend>
        <div className="flex gap-2" role="radiogroup" aria-label="Rating from 1 to 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} onClick={() => setRating(n)} className={`choice w-14 text-[20px] ${rating === n ? '!bg-ink !text-white !border-ink' : ''}`}>{n}</button>
          ))}
        </div>
        <p className="mt-1.5 text-[14px] text-muted">5 is the best.</p>
      </fieldset>
      <div><label className="label" htmlFor="b">Tell us more <span className="font-normal">(optional)</span></label><textarea id="b" name="body" maxLength={1000} className="field !py-3 min-h-[100px]" /></div>
      <div className="grid gap-2">
        <label className="label !mb-0" htmlFor="p">A photo of the finished job <span className="font-normal">(optional)</span></label>
        <input id="p" type="file" accept="image/jpeg,image/png,image/webp" className="field !py-2.5" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        {preview && (
          <div className="flex items-start gap-3 rounded-md2 bg-paper2 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Your photo" className="h-24 w-24 rounded-sm2 object-cover" />
            <div className="grid gap-1 text-[14px]"><p className="text-muted">Only we see this at first. A person at Brandit checks it before anyone else can. We remove the location and camera details from it.</p><button type="button" className="link self-start" onClick={() => setPhoto(null)}>Remove photo</button></div>
          </div>
        )}
        {err?.field === 'photo' && <p role="alert" className="text-[14px] text-bad">{err.message}</p>}
      </div>
      <label className="flex min-h-[44px] cursor-pointer items-start gap-3"><input type="checkbox" name="public_ok" className="mt-1 h-5 w-5 accent-[#0B1F33]" /><span className="text-[15px]"><span className="font-bold">You may show my words on the Brandit website.</span> <span className="text-muted">Only your first name and what you ordered. We choose which reviews to show, and you can ask us to remove yours at any time.</span></span></label>
      {photo && <label className="flex min-h-[44px] cursor-pointer items-start gap-3"><input type="checkbox" name="photo_ok" className="mt-1 h-5 w-5 accent-[#0B1F33]" /><span className="text-[15px]"><span className="font-bold">You may show my photo too</span> <span className="text-muted">if a person at Brandit checks it and picks it. Leave this unticked to keep it private.</span></span></label>}
      <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send review'}</button>
    </form>
  );
}
