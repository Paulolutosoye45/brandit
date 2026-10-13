import { EngineError } from './types';

/** One place for talking to vendors: a time limit, a retry on the usual transient errors, and a safe way to fetch the picture they point to. */
export async function vendorFetch(url: string, init: RequestInit, o: { timeoutMs?: number; retries?: number; what?: string } = {}): Promise<Response> {
  const { timeoutMs = 90_000, retries = 1, what = 'The picture maker' } = o;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) {
        last = new EngineError(`${what} answered ${res.status}`, true);
        if (attempt < retries) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
        throw last;
      }
      return res;
    } catch (e) {
      last = e;
      if (e instanceof EngineError && !e.retryable) throw e;
      if (attempt < retries) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    }
  }
  if (last instanceof EngineError) throw last;
  throw new EngineError(`${what} did not answer: ${(last as Error)?.message ?? last}`, true);
}

export async function jsonOrThrow(res: Response, what: string): Promise<any> {
  const text = await res.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) {
    const msg = j?.error?.message ?? j?.message ?? j?.detail ?? text.slice(0, 200);
    // A refusal on content grounds is not worth retrying with the same words.
    const blocked = /safety|policy|moderation|blocked|prohibited|content/i.test(String(msg)) && res.status >= 400 && res.status < 500;
    throw new EngineError(`${what} ${res.status}: ${String(msg).slice(0, 300)}`, !blocked && res.status !== 401 && res.status !== 403 && res.status !== 402,
      blocked ? 'That request could not be made. Try describing the look in a different way.' : 'The picture maker did not answer. Please try again in a moment.');
  }
  return j;
}

const privateHost = (h: string) => /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd])/i.test(h) || !h.includes('.');

/** Download a picture a vendor gave us a link to. Only https, never an address inside our own network, and never huge. */
export async function download(url: string, maxBytes = 60_000_000): Promise<{ buf: Buffer; mime: string }> {
  let u: URL;
  try { u = new URL(url); } catch { throw new EngineError('The picture maker returned a bad link', true); }
  if (u.protocol !== 'https:' || privateHost(u.hostname)) throw new EngineError('The picture maker returned a link we do not follow', false);
  const res = await vendorFetch(u.toString(), { method: 'GET' }, { timeoutMs: 60_000, retries: 1, what: 'The picture download' });
  if (!res.ok) throw new EngineError(`Download failed (${res.status})`, true);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new EngineError('The picture is too large', false);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new EngineError('The picture is too large', false);
  return { buf, mime: res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream' };
}
