import { isDemo } from './db';
import { googleOn } from './google';
import { channelOn } from './otp';

/** Which sign-in methods to offer. In demo mode all three work, with codes shown on screen. */
export function authMethods() {
  const demo = isDemo();
  return { google: googleOn() || demo, email: channelOn('email') || demo, phone: channelOn('phone') || demo, demo, realGoogle: googleOn() };
}
