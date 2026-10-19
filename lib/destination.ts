import type { Customer } from './identity';
import { safeNext } from './safeNext';

/**
 * Where a person goes right after signing in: back to where they were. There is no details page in between.
 * Checkout asks for the name and number it needs, at the moment it needs them.
 */
export const destination = (_c: Pick<Customer, 'name' | 'phone' | 'whatsapp_phone'>, next: string) => safeNext(next);

/** Demo only: stand-ins for Google accounts, shown until real Google credentials are set. */
export const DEMO_GOOGLE = [
  { sub: 'demo-google-1', name: 'Tunde Adeyemi', email: 'tunde.adeyemi@example.com' },
  { sub: 'demo-google-2', name: 'Chioma Okafor', email: 'chioma.okafor@example.com' },
  { sub: 'demo-google-3', name: 'Ibrahim Bello', email: 'ibrahim.bello@example.com' },
];
