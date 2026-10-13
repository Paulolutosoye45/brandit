import { needsProfile, type Customer } from './identity';
import { safeNext } from './safeNext';

/** Where a person goes right after signing in: finish their details first if we are missing any. */
export const destination = (c: Pick<Customer, 'name' | 'phone' | 'whatsapp_phone'>, next: string) => {
  const n = safeNext(next);
  return needsProfile(c) ? `/welcome?next=${encodeURIComponent(n)}` : n;
};

/** Demo only: stand-ins for Google accounts, shown until real Google credentials are set. */
export const DEMO_GOOGLE = [
  { sub: 'demo-google-1', name: 'Tunde Adeyemi', email: 'tunde.adeyemi@example.com' },
  { sub: 'demo-google-2', name: 'Chioma Okafor', email: 'chioma.okafor@example.com' },
  { sub: 'demo-google-3', name: 'Ibrahim Bello', email: 'ibrahim.bello@example.com' },
];
