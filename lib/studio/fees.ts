import type { Settings } from '../settings-defaults';
import { allowanceFor, priceOf, type Tier } from './config';

/** What a paid line says while Studio is making the design and the customer has not approved one yet. */
export const STUDIO_WAIT = 'Waiting for your Studio design. Pick one and approve it, then printing starts.';

/** What the design costs on the order: Studio's price for the tier, less the print credit it comes with. Never below zero. */
export function studioFeeKobo(s: Settings, tier: Tier): number {
  return Math.max(0, priceOf(s, tier) - allowanceFor(tier, s).creditKobo);
}
