/** Shows what someone typed or pasted as a Nigerian mobile number: "0803 123 4567", "+234 803..." and "803..." all become "803 123 4567". */
export function formatLocal(input: string): string {
  let d = String(input ?? '').replace(/\D/g, '');
  if (d.startsWith('234') && d.length > 10) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  d = d.slice(0, 10);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)].filter(Boolean).join(' ');
}
export const toE164 = (display: string) => `+234${String(display).replace(/\D/g, '')}`;
export const maskIdentifier = (channel: 'email' | 'phone', id: string) => {
  if (channel === 'phone') return `${id.slice(0, 4)} ${id.slice(4, 7)} ••• ${id.slice(-4)}`;
  const [u, d] = id.split('@');
  return `${u.slice(0, Math.min(2, u.length))}${'•'.repeat(Math.max(2, Math.min(5, u.length - 2)))}@${d}`;
};
