'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Add a logo, an approved design or another file to the brand kit. */
export function AssetUploader({ room, maxMb }: { room: number; maxMb: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState('logo');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  async function send(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.append('file', f); fd.append('kind', kind); fd.append('title', title);
    try {
      const res = await fetch('/api/account/brand/assets', { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({ ok: false, error: 'The upload failed. Try again.' }));
      if (d.ok) { setMsg({ tone: 'good', text: 'Added to your brand kit.' }); setTitle(''); router.refresh(); }
      else setMsg({ tone: 'bad', text: d.error || 'The upload failed.' });
    } catch {
      setMsg({ tone: 'bad', text: 'The upload failed. Check your connection and try again.' });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="grid gap-3 rounded-md2 bg-paper2 p-4">
      <p className="font-bold">Add a file</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="bk-kind">What is it?</label>
          <select id="bk-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="field"><option value="logo">Logo</option><option value="design">Approved design</option><option value="other">Other file</option></select></div>
        <div><label className="label" htmlFor="bk-title">Name <span className="font-normal text-muted">(optional)</span></label><input id="bk-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className="field" placeholder="Main logo, white version" /></div>
      </div>
      <input ref={input} id="bk-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(e) => send(e.target.files)} disabled={busy || room <= 0} />
      <label htmlFor="bk-file" className={`btn-primary btn-sm cursor-pointer self-start ${busy || room <= 0 ? 'pointer-events-none opacity-60' : ''}`}>{busy ? 'Uploading…' : 'Choose a file'}</label>
      <p className="text-[13px] text-muted">{room > 0 ? `JPG, PNG, WebP or PDF, up to ${maxMb} MB. You can add ${room} more.` : 'Your brand kit is full. Remove a file to add another.'} We keep your file exactly as you send it, so it prints sharp.</p>
      {msg && <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`rounded-md2 px-4 py-3 text-[15px] ${msg.tone === 'good' ? 'bg-good-tint' : 'bg-bad-tint'}`}>{msg.text}</p>}
    </div>
  );
}
