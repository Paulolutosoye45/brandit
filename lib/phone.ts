/** Nigerian mobile numbers only: 0803 123 4567, 803 123 4567, 234803..., +234803... all become +2348031234567. */
export function normalizePhone(input: string): string | null {
  let d = String(input ?? '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('234')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  if (!/^[789]\d{9}$/.test(d)) return null;
  return `+234${d}`;
}
export const maskPhone = (p: string) => `${p.slice(0, 7)}•••${p.slice(-3)}`;
