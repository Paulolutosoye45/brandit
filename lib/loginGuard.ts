import { limited } from './ratelimit';

/**
 * Too many team sign-in tries? Counted twice: per address, and per account whatever the address.
 * The second count is the one that matters, because an address can be faked and an email cannot.
 * Six digits is a million PINs. Ten tries per 15 minutes per account makes guessing take years.
 */
export function tooManyStaffLoginTries(email: string, ip: string): boolean {
  const byAddress = limited(`login:${email}:${ip}`, 6, 15 * 60_000);
  const byAccount = limited(`login-account:${email}`, 10, 15 * 60_000);
  return byAddress || byAccount;
}
