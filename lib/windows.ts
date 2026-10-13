/*
 * Delivery windows. A customer who wants their order delivered (not collected) can say which part of the day suits them.
 * It is a plan for the rider, not a change to the Brandit Promise: a 24-hour order still arrives by 5pm the same day,
 * so it can only be an afternoon delivery; a standard order can ask for the morning or the afternoon.
 */
export type DeliveryWindow = 'morning' | 'afternoon';
export const WINDOWS: { key: DeliveryWindow; label: string; range: string }[] = [
  { key: 'morning', label: 'Morning', range: '9am to 1pm' },
  { key: 'afternoon', label: 'Afternoon', range: '1pm to 5pm' },
];
export const isWindow = (v: unknown): v is DeliveryWindow => v === 'morning' || v === 'afternoon';
export const windowRange = (w: DeliveryWindow) => WINDOWS.find((x) => x.key === w)!.range;
export const windowText = (w: DeliveryWindow) => `${WINDOWS.find((x) => x.key === w)!.label} (${windowRange(w)})`;

type Ctx = { speed: '24h' | 'standard' | string | null; pickup: boolean; enabled?: boolean };

/** The windows a customer can choose from for this order. Pickup has none; a 24-hour order has only the afternoon. */
export function availableWindows(c: Ctx): DeliveryWindow[] {
  if (c.pickup || c.enabled === false) return [];
  if (c.speed === '24h') return ['afternoon'];
  return ['morning', 'afternoon'];
}

/**
 * The window that will actually apply. What the customer asked for is kept as they chose it; this turns it into
 * what is possible now (for example, a morning request on an order that became a 24-hour order is an afternoon delivery).
 */
export function effectiveWindow(requested: unknown, c: Ctx): DeliveryWindow | null {
  if (c.pickup || c.enabled === false) return null;
  if (c.speed === '24h') return 'afternoon';
  return isWindow(requested) ? requested : null;
}

/** What to store at checkout: the choice as made, or nothing for pickup or when windows are switched off. */
export function windowToStore(requested: unknown, c: { pickup: boolean; enabled: boolean }): DeliveryWindow | null {
  if (c.pickup || !c.enabled) return null;
  return isWindow(requested) ? requested : null;
}
