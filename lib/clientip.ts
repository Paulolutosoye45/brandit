/**
 * The visitor's address, used for rate limits.
 *
 * X-Forwarded-For lists every address a request passed through, oldest first, and a caller can start the
 * list with whatever they like. Only the entries added by YOUR proxies can be believed, and those sit at
 * the END of the list. So we count back from the end:
 *   TRUSTED_PROXY_HOPS = how many proxies of yours sit between the visitor and this app.
 * Left unset (0) we use the first entry, which is the old behaviour and can be faked.
 * The console Setup page shows the address the server reads for you, so you can check the number.
 */
export function clientIp(forwardedFor: string | null | undefined, hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0)): string {
  const parts = String(forwardedFor ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return 'local';
  const n = Number.isFinite(hops) ? Math.max(0, Math.trunc(hops)) : 0;
  if (n === 0 || parts.length < n) return parts[0];
  return parts[parts.length - n];
}
