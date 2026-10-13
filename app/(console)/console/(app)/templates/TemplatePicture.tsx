'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Upload the one preview picture for a template. It replaces the drawn preview. */
export function TemplatePicture({ id, hasImage }: { id: string; hasImage: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  async function send(files: FileList | null) {
    if (!files?.[0]) return;
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.append('photo', files[0]);
    try {
      const res = await fetch(`/api/console/templates/${id}/image`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({ ok: false, error: 'The upload failed. Check your connection and try again.' }));
      setMsg(data.ok ? { tone: 'good', text: 'Picture saved.' } : { tone: 'bad', text: data.error || 'The upload failed.' });
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
      <input ref={input} id="tpl-pic" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => send(e.target.files)} disabled={busy} />
      <label htmlFor="tpl-pic" className={`btn-primary btn-sm self-start cursor-pointer ${busy ? 'pointer-events-none opacity-60' : ''}`}>{busy ? 'Uploading…' : hasImage ? 'Replace picture' : 'Add a picture'}</label>
      <p className="text-[13px] text-muted">Optional. A sample of a finished design, JPG, PNG or WebP up to 8 MB. Portrait (4 by 5) looks best.</p>
      {msg && <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`rounded-md2 px-4 py-3 text-[15px] ${msg.tone === 'good' ? 'bg-good-tint' : 'bg-bad-tint'}`}>{msg.text}</p>}
    </div>
  );
}
