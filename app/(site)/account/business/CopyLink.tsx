'use client';
import { useState } from 'react';

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* the link is on screen to copy by hand */ }
  }
  const wa = `https://wa.me/?text=${encodeURIComponent(`Join our company on Brandit so we can order prints together: ${url}`)}`;
  return (
    <div className="grid gap-2">
      <input readOnly value={url} className="field tabular" aria-label="Join link" onFocus={(e) => e.currentTarget.select()} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        <a className="btn-secondary btn-sm" href={wa} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>
      </div>
    </div>
  );
}
