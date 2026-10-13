import { one } from './db';
import { getSettings } from './settings';

type Identity = { customerId?: string | null; phone?: string | null; email?: string | null };

/**
 * Referral codes and reward codes belong to a customer.
 *  - A referral code is for a friend. The person who owns it cannot use it on themselves.
 *  - A reward code is for the person it was sent to, and nobody else.
 * Returns the words to show the customer when a code cannot be used, or null when it can.
 */
export async function ownerCheck(c: { source: string; owner_customer_id: string | null }, id: Identity): Promise<string | null> {
  if (c.source === 'manual') return null;
  const s = await getSettings();
  if (c.source === 'referral' && !s.referral_enabled) return 'That code is not valid. Check the spelling and try again.';
  const owner = c.owner_customer_id ? await one<{ id: string; phone: string | null; whatsapp_phone: string | null; email: string | null }>('select id, phone, whatsapp_phone, email from customers where id = $1', [c.owner_customer_id]) : null;
  const same =
    !!owner &&
    ((!!id.customerId && id.customerId === owner.id) ||
      (!!id.phone && [owner.phone, owner.whatsapp_phone].includes(id.phone)) ||
      (!!id.email && !!owner.email && owner.email.toLowerCase() === id.email.trim().toLowerCase()));
  if (c.source === 'referral') return same ? 'This is your own referral code. Share it with a friend, and you both win.' : null;
  // reward
  if (same) return null;
  const known = !!(id.customerId || id.phone || id.email);
  return known ? 'That code is not valid. Check the spelling and try again.' : 'This code belongs to one account. Sign in to that account, then use it at checkout.';
}
