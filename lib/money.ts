/** Money is whole kobo everywhere. Format only at the screen. */
export const naira = (kobo: number): string => {
  const whole = Math.trunc(kobo / 100);
  const rem = Math.abs(kobo % 100);
  const body = Math.abs(whole).toLocaleString('en-US');
  const sign = kobo < 0 ? '-' : '';
  return rem === 0 ? `${sign}₦${body}` : `${sign}₦${body}.${String(rem).padStart(2, '0')}`;
};
export const toKobo = (nairaAmount: number) => Math.round(nairaAmount * 100);
