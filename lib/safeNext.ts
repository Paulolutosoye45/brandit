/** Where to go after signing in. Only paths on this site are allowed, so a crafted link cannot send someone elsewhere. */
export function safeNext(v: unknown, fallback = '/account'): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\') || /[\r\n\t]/.test(s)) return fallback;
  if (s.startsWith('/api/') || s.startsWith('/signin') || s.startsWith('/welcome')) return fallback;
  return s;
}
