import { clientIp } from './clientip';
// A small in-memory limiter for public endpoints. It stops casual abuse on one server.
// For several servers, back it with a shared store (Redis or Postgres).
const hits = new Map<string, number[]>();
export function limited(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return arr.length > max;
}
export const ipOf = (req: Request) => clientIp(req.headers.get('x-forwarded-for')); // see lib/clientip.ts
