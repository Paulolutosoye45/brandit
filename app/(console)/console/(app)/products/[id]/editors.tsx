'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/*
 * The small interactive editors on the product page. Each keeps its rows in state and hands the whole
 * list to a server action as one JSON field, so a save is all-or-nothing.
 */

// ---------- Photo upload ----------
export function ImageUploader({ productId, count, max }: { productId: string; count: number; max: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const room = max - count;

  async function send(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    Array.from(files).slice(0, Math.max(room, 0)).forEach((f) => fd.append('photos', f));
    try {
      const res = await fetch(`/api/console/products/${productId}/images`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({ ok: false, errors: ['The upload failed. Check your connection and try again.'] }));
      const errs: string[] = data.errors ?? (data.error ? [data.error] : []);
      if (data.added) setMsg({ tone: 'good', text: `${data.added} photo${data.added === 1 ? '' : 's'} added.${errs.length ? ' ' + errs.join(' ') : ''}` });
      else setMsg({ tone: 'bad', text: errs.join(' ') || 'The upload failed. Try again.' });
      router.refresh();
    } catch {
      setMsg({ tone: 'bad', text: 'The upload failed. Check your connection and try again.' });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="grid gap-2">
      <input ref={input} id="photo-input" type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => send(e.target.files)} disabled={busy || room <= 0} />
      <label htmlFor="photo-input" className={`btn-primary btn-sm self-start cursor-pointer ${busy || room <= 0 ? 'opacity-60 pointer-events-none' : ''}`}>{busy ? 'Uploading…' : 'Add photos'}</label>
      <p className="text-[13px] text-muted">{room > 0 ? `JPG, PNG or WebP, up to 8 MB each. You can add ${room} more. Photos taken on a phone are fine; we shrink them for fast loading.` : `This product has the most photos allowed (${max}). Remove one to add another.`}</p>
      {msg && <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`rounded-md2 px-4 py-3 text-[15px] ${msg.tone === 'good' ? 'bg-good-tint' : 'bg-bad-tint'}`}>{msg.text}</p>}
    </div>
  );
}
