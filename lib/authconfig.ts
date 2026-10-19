import { isDemo } from './db';
import { googleOn } from './google';
import { channelOn } from './otp';

/** Which sign-in methods to offer. In demo mode all three work, with codes shown on screen. */
export function authMethods() {
  const demo = isDemo();
  return { google: googleOn() || demo, email: channelOn('email') || demo, phone: channelOn('phone') || demo, demo, realGoogle: googleOn() };
}

/**
 * Can a customer sign in with a verified email or a Google account? If so, paying needs an account.
 * Phone codes are not offered. If neither is set up yet, guests can still pay, so the shop never stops selling.
 */
export function signInAvailable(): boolean {
  const m = authMethods();
  return m.google || m.email;
}
