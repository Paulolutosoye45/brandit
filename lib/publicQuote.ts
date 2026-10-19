import type { Quote } from './quote';

/** The part of a quote the browser needs. Prices and promises are always decided on the server. */
export function publicQuote(q: Quote) {
  return {
    ok: true as const,
    product: { slug: q.product.slug, name: q.product.name },
    priceKobo: q.priceKobo,
    extrasKobo: q.extrasKobo,
    lines: q.lines.map((l) => ({ kind: l.kind, label: l.label, detail: l.detail, kobo: l.kobo })),
    notes: q.notes,
    config: q.config,
    effective: q.effective,
    basis: q.basis,
    fromStep: q.fromStep,
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
    // The print area in inches, so the builder can draw a file at the right shape.
    printW: q.printW,
    printH: q.printH,
    // Only on the product page. Nothing here says what anything costs us.
    ladder: q.ladder ?? null,
    packages: q.packages ?? null,
    availability: q.availability ?? null,
  };
}
