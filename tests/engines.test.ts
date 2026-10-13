import { describe, expect, it } from 'vitest';
import { priceItem, priceOrder, PriceError, type PriceRule } from '../lib/pricing';
import { promise, type PromiseRule } from '../lib/promise';
import { DEFAULT_SETTINGS } from '../lib/settings-defaults';
import { addWorkingDays, describeArrival, lagosDate, lagosParts, productionDay } from '../lib/time';
import { checkArtwork, effectiveDpi, recommendSize } from '../lib/accuracy';
import { naira } from '../lib/money';

const S = DEFAULT_SETTINGS;
// Lagos is UTC+1 all year. Monday 12 Oct 2026 11:59 Lagos = 10:59 UTC.
const lagos = (ymd: string, hhmm: string) => lagosDate(ymd, hhmm);

describe('pricing', () => {
  const tier = (q: number, p: number): PriceRule => ({ config: {}, quantity: q, size_key: null, price_kobo: p, rate_per_sqft_kobo: null, min_area_sqft: null, active: true });
  const area: PriceRule = { config: {}, quantity: null, size_key: null, price_kobo: null, rate_per_sqft_kobo: 70_000, min_area_sqft: 10, active: true };
  const size = (k: string, p: number): PriceRule => ({ config: {}, quantity: null, size_key: k, price_kobo: p, rate_per_sqft_kobo: null, min_area_sqft: null, active: true });

  it('100 business cards cost ₦15,000', () => {
    const r = priceItem('tier', [tier(100, 1_500_000), tier(250, 3_000_000)], { quantity: 100, config: {} });
    expect(naira(r.totalKobo)).toBe('₦15,000');
  });
  it('a 5 x 3 ft flex banner is ₦10,500', () => {
    const r = priceItem('area', [area], { quantity: 1, config: {}, widthFt: 5, heightFt: 3 });
    expect(r.totalKobo).toBe(1_050_000);
    expect(r.areaSqft).toBe(15);
  });
  it('a 2 x 2 ft banner is billed at the 10 sq ft minimum, ₦7,000', () => {
    const r = priceItem('area', [area], { quantity: 1, config: {}, widthFt: 2, heightFt: 2 });
    expect(r.totalKobo).toBe(700_000);
  });
  it('rounds each banner up to a whole square foot', () => {
    const r = priceItem('area', [area], { quantity: 2, config: {}, widthFt: 5.5, heightFt: 3 }); // 16.5 -> 17 each
    expect(r.areaSqft).toBe(34);
    expect(r.totalKobo).toBe(34 * 70_000);
  });
  it('size mode multiplies by quantity', () => {
    const r = priceItem('size', [size('16x20', 2_200_000)], { quantity: 3, config: {}, sizeKey: '16x20' });
    expect(r.totalKobo).toBe(6_600_000);
  });
  it('refuses quantities with no price and bad input', () => {
    expect(() => priceItem('tier', [tier(100, 1)], { quantity: 150, config: {} })).toThrow(PriceError);
    expect(() => priceItem('area', [area], { quantity: 1, config: {}, widthFt: 0, heightFt: 3 })).toThrow(PriceError);
    expect(() => priceItem('area', [area], { quantity: 1, config: {}, widthFt: 99, heightFt: 3 })).toThrow(PriceError);
    expect(() => priceItem('tier', [tier(100, 1)], { quantity: -1, config: {} })).toThrow(PriceError);
  });
  it('ignores inactive rules', () => {
    expect(() => priceItem('tier', [{ ...tier(100, 1), active: false }], { quantity: 100, config: {} })).toThrow(PriceError);
  });
  it('order totals: VAT is inside the price by default', () => {
    const t = priceOrder({ itemsKobo: [1_500_000], deliveryFeeKobo: 150_000, pickup: false, vatRate: 0.075, pricesIncludeVat: true });
    expect(t.totalKobo).toBe(1_650_000);
    expect(t.vatKobo).toBe(Math.round((1_650_000 * 0.075) / 1.075));
  });
  it('pickup removes the delivery fee', () => {
    const t = priceOrder({ itemsKobo: [1_500_000], deliveryFeeKobo: 150_000, pickup: true, vatRate: 0.075, pricesIncludeVat: true });
    expect(t.deliveryKobo).toBe(0);
    expect(t.totalKobo).toBe(1_500_000);
  });
});

describe('time', () => {
  it('Lagos is one hour ahead of UTC', () => {
    expect(lagosParts(new Date('2026-10-12T10:59:00Z')).hh).toBe(11);
  });
  it('skips Sundays and holidays', () => {
    expect(addWorkingDays('2026-10-10', 1, S)).toBe('2026-10-12'); // Sat -> Mon
    expect(addWorkingDays('2026-09-30', 1, S)).toBe('2026-10-02'); // Wed -> skip Thu 1 Oct holiday
  });
  it('describes arrivals in plain words', () => {
    const now = lagos('2026-10-12', '09:00');
    expect(describeArrival(lagos('2026-10-12', '17:00'), now)).toBe('today by 5pm');
    expect(describeArrival(lagos('2026-10-13', '17:00'), now)).toBe('tomorrow by 5pm');
    expect(describeArrival(lagos('2026-10-15', '17:00'), now)).toBe('Thursday 15 Oct by 5pm');
  });
});

describe('promise engine', () => {
  const rule: PromiseRule = { eligible_24h: true, max_quantity: 500, max_area_sqft: null, max_size_rank: null, excluded_choices: [], standard_days: 3 };
  const base = { rule, settings: S, zoneEligible24h: true, pickup: false, quantity: 100, totalAreaSqft: null, sizeRank: null, choices: [] as string[], slotsUsed: 0 };

  it('at 11:59 on a Monday the promise is tomorrow by 5pm', () => {
    const now = lagos('2026-10-12', '11:59');
    const r = promise({ ...base, now });
    expect(r.tier).toBe('24h');
    expect(r.productionDay).toBe('2026-10-12');
    expect(r.arriveBy.toISOString()).toBe(lagos('2026-10-13', '17:00').toISOString());
    expect(describeArrival(r.arriveBy, now)).toBe('tomorrow by 5pm');
  });
  it('at 12:01 the promise moves one working day later', () => {
    const r = promise({ ...base, now: lagos('2026-10-12', '12:01') });
    expect(r.tier).toBe('24h');
    expect(r.productionDay).toBe('2026-10-13');
    expect(r.arriveBy.toISOString()).toBe(lagos('2026-10-14', '17:00').toISOString());
  });
  it('an order on Saturday afternoon is promised for Tuesday', () => {
    const r = promise({ ...base, now: lagos('2026-10-10', '14:00') });
    expect(r.productionDay).toBe('2026-10-12');
    expect(r.arriveBy.toISOString()).toBe(lagos('2026-10-13', '17:00').toISOString());
    expect(lagosParts(r.arriveBy).dow).toBe(2);
  });
  it('over the limit gets standard delivery with the reason', () => {
    const r = promise({ ...base, quantity: 1000, now: lagos('2026-10-12', '09:00') });
    expect(r.tier).toBe('standard');
    expect(r.reasons).toEqual(['QUANTITY']);
    expect(r.arriveBy.toISOString()).toBe(lagos('2026-10-15', '17:00').toISOString()); // Mon + 3 working days
  });
  it('four 10 x 5 ft banners (200 sq ft) are standard, with the area reason', () => {
    const flex: PromiseRule = { ...rule, max_quantity: null, max_area_sqft: 150 };
    const r = promise({ ...base, rule: flex, quantity: 4, totalAreaSqft: 200, now: lagos('2026-10-12', '09:00') });
    expect(r.tier).toBe('standard');
    expect(r.reasons).toContain('AREA');
  });
  it('a 16x20 frame is 24-hour and a 24x36 frame is standard', () => {
    const frame: PromiseRule = { ...rule, max_quantity: 5, max_size_rank: 2 };
    expect(promise({ ...base, rule: frame, quantity: 1, sizeRank: 2, now: lagos('2026-10-12', '09:00') }).tier).toBe('24h');
    const big = promise({ ...base, rule: frame, quantity: 1, sizeRank: 4, now: lagos('2026-10-12', '09:00') });
    expect(big.tier).toBe('standard');
    expect(big.reasons).toContain('SIZE');
  });
  it('outer zones, pause and a full day each force standard', () => {
    const now = lagos('2026-10-12', '09:00');
    expect(promise({ ...base, zoneEligible24h: false, now }).reasons).toContain('ZONE');
    expect(promise({ ...base, zoneEligible24h: false, pickup: true, now }).tier).toBe('24h');
    expect(promise({ ...base, settings: { ...S, slots_paused: true }, now }).reasons).toContain('PAUSED');
    const full = promise({ ...base, slotsUsed: S.daily_24h_slots, now });
    expect(full.reasons).toContain('FULL');
    expect(full.slotsLeft).toBe(0);
  });
  it('production day follows the cut-off', () => {
    expect(productionDay(lagos('2026-10-12', '11:59'), S)).toBe('2026-10-12');
    expect(productionDay(lagos('2026-10-12', '12:00'), S)).toBe('2026-10-13');
  });
});

describe('accuracy check', () => {
  const T = DEFAULT_SETTINGS.check_thresholds;
  const mk = (widthPx: number, heightPx: number, cls: 'print' | 'photo' | 'large' = 'print', pw = 3.5, ph = 2) =>
    checkArtwork({ facts: { mime: 'image/png', bytes: 500_000, widthPx, heightPx }, printWIn: pw, printHIn: ph, cls, thresholds: T, maxBytes: 100_000_000 });

  it('a small blurry logo on a business card is stopped, in plain words', () => {
    const r = mk(200, 114);
    expect(r.status).toBe('stop');
    expect(r.headline.toLowerCase()).toContain('blurry');
  });
  it('a sharp business card file passes', () => {
    const r = mk(1050, 600); // 300 dpi at 3.5 x 2
    expect(r.status).toBe('pass');
    expect(r.dpi).toBe(300);
  });
  it('in-between resolution is a warning, not a stop', () => {
    expect(mk(700, 400).status).toBe('warn'); // 200 dpi
  });
  it('banners accept lower resolution than cards', () => {
    const banner = (w: number, h: number) =>
      checkArtwork({ facts: { mime: 'image/jpeg', bytes: 1, widthPx: w, heightPx: h }, printWIn: 60, printHIn: 36, cls: 'large', thresholds: T, maxBytes: 1e9 });
    expect(banner(6000, 3600).status).toBe('pass'); // 100 dpi is fine for a banner
    expect(banner(3600, 2160).status).toBe('warn'); // 60 dpi: usable, with a note
    expect(banner(1000, 600).status).toBe('stop'); // about 17 dpi: far too small
    expect(mk(1000, 600, 'print', 12, 7.2).status).toBe('stop'); // the same pixels fail on a flyer-class product
  });
  it('rejects unknown file types and oversize files', () => {
    expect(checkArtwork({ facts: { mime: 'image/gif', bytes: 1 }, printWIn: 1, printHIn: 1, cls: 'print', thresholds: T, maxBytes: 1e9 }).status).toBe('stop');
    expect(checkArtwork({ facts: { mime: 'image/png', bytes: 200_000_000, widthPx: 9, heightPx: 9 }, printWIn: 1, printHIn: 1, cls: 'print', thresholds: T, maxBytes: 100_000_000 }).status).toBe('stop');
  });
  it('flags a different shape and ignores orientation', () => {
    expect(mk(1000, 1000).lines.find((l) => l.id === 'shape')!.status).toBe('warn');
    expect(mk(600, 1050).lines.find((l) => l.id === 'shape')!.status).toBe('pass'); // portrait photo, landscape card
  });
  it('recommends the largest frame a photo will print sharp at', () => {
    const sizes = [
      { key: '8x10', label: '8 × 10', w_in: 8, h_in: 10 },
      { key: '12x16', label: '12 × 16', w_in: 12, h_in: 16 },
      { key: '16x20', label: '16 × 20', w_in: 16, h_in: 20 },
      { key: '24x36', label: '24 × 36', w_in: 24, h_in: 36 },
    ];
    // 3000 x 4000 phone photo at 200 dpi
    expect(recommendSize(sizes, 3000, 4000, 200)?.key).toBe('12x16'); // 24x36 needs 4800 x 7200; 16x20 needs 3200x4000
    expect(recommendSize(sizes, 600, 800, 200)).toBeNull();
    expect(Math.round(effectiveDpi(3000, 4000, 12, 16))).toBe(250);
  });
});
