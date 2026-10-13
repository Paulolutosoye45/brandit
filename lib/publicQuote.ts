import type { Quote } from './quote';

/** The part of a quote the browser needs. Prices and promises are always decided on the server. */
export function publicQuote(q: Quote) {
  return {
    ok: true as const,
    product: { slug: q.product.slug, name: q.product.name },
    priceKobo: q.priceKobo,
    extrasKobo: q.extrasKobo,
    quantity: q.quantity,
    deliveryKobo: q.deliveryKobo,
    totalKobo: q.priceKobo + q.deliveryKobo,
    unitLabel: q.unitLabel,
    areaSqft: q.areaSqft,
    zone: q.zone ? { id: q.zone.id, name: q.zone.name } : null,
    tier: q.tier,
    reasonTexts: q.reasonTexts,
    arriveBy: q.arriveBy,
    arrivalText: q.arrivalText,
    cutoffAt: q.cutoffAt,
    countdownMs: q.countdownMs,
    slotsLeft: q.slotsLeft,
    meetsDeadline: q.meetsDeadline,
    sizeKey: q.sizeKey,
  };
}
