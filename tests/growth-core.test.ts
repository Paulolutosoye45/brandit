import { describe, expect, it } from 'vitest';
import { cleanAnswers, composeWording, parseFieldLines, fieldsToLines, slugify, isPalette, isLayout } from '../lib/templateCore';
import { EVENT_TYPES, ITEMS, checkPlan, needByFor, snapQuantity, suggest, planDetails, planTitle, EVENT_BUFFER_DAYS } from '../lib/eventPlanCore';
import { phaseOf, leftText, daysBetween, validYmd, themeOf } from '../lib/campaignCore';
import { availableWindows, effectiveWindow, windowToStore, windowText } from '../lib/windows';
import { validPos, mapLink, riderWhatsAppLink, validRiderToken } from '../lib/rider';
import { normalizeHex, normalizeWebsite } from '../lib/brandKit';
import { TEMPLATES, STAFF_TEMPLATES, render, type TemplateKey } from '../content/messages';
import { PIDGIN_UI, translator } from '../content/pidgin-ui';

describe('ready-made templates (the parts that need no database)', () => {
  const fields = parseFieldLines('Church name* | As it should appear\nService date* | Pick the day | date\nOrder of service | One per line | long\nContact');
  it('reads one question per line, with required, hint and kind', () => {
    expect(fields.map((f) => [f.label, f.required, f.kind])).toEqual([
      ['Church name', true, 'text'], ['Service date', true, 'date'], ['Order of service', false, 'long'], ['Contact', false, 'text'],
    ]);
    expect(new Set(fields.map((f) => f.key)).size).toBe(4);
  });
  it('round-trips through the console text box', () => {
    expect(parseFieldLines(fieldsToLines(fields))).toEqual(fields);
  });
  it('gives repeated labels different keys and caps the list at twelve questions', () => {
    const two = parseFieldLines('Name\nName');
    expect(two[0].key).not.toBe(two[1].key);
    expect(parseFieldLines(Array.from({ length: 30 }, (_, i) => `Q${i}`).join('\n'))).toHaveLength(12);
  });
  it('keeps only the answers to questions we asked, trimmed, and names the first required one that is missing', () => {
    const r = cleanAnswers(fields, { church_name: '  Grace   Chapel ', injected: 'evil', contact: 5 });
    expect(r.answers).toEqual({ church_name: 'Grace Chapel' });
    expect(r.missing?.label).toBe('Service date');
    expect(cleanAnswers(fields, { church_name: 'A', service_date: '2026-12-13' }).missing).toBeNull();
  });
  it('writes the designer\'s brief with dates in words', () => {
    const w = composeWording(fields, { church_name: 'Grace Chapel', service_date: '2026-12-13', order_of_service: 'Praise\nWord' });
    expect(w).toContain('Church name: Grace Chapel');
    expect(w).toMatch(/Service date: .*13 December 2026/);
    expect(w).toContain('Order of service:\nPraise\nWord');
  });
  it('makes clean slugs and recognises palettes and layouts', () => {
    expect(slugify('Church & Mosque: Thanksgiving!')).toBe('church-and-mosque-thanksgiving');
    expect(isPalette('ink') && !isPalette('neon')).toBe(true);
    expect(isLayout('flyer') && !isLayout('hologram')).toBe(true);
  });
});

describe('plan my event (the parts that need no database)', () => {
  const have = new Set(['flyers', 'posters', 'flex-banners']);
  const today = '2026-10-12';
  it('suggests sensible quantities from the guest count and ticks what suits the event', () => {
    const wedding = suggest('wedding', 200);
    expect(wedding.invitations).toEqual({ on: true, qty: 100 });
    expect(wedding.programmes.qty).toBe(200);
    expect(wedding.banner.on).toBe(true);
    expect(wedding.badges.on).toBe(false);
    expect(suggest('corporate', 100).badges.on).toBe(true);
    expect(suggest('other', 100).invitations.on).toBe(false);
    expect(suggest('wedding', 0).invitations.qty).toBeGreaterThan(0); // guest count is clamped
  });
  it('knows every event type and every item', () => {
    expect(EVENT_TYPES.length).toBeGreaterThanOrEqual(7);
    expect(new Set(ITEMS.map((i) => i.key)).size).toBe(ITEMS.length);
  });
  it('needs the prints a couple of days before the event, never in the past', () => {
    expect(needByFor('2026-12-20', today)).toBe('2026-12-18');
    expect(needByFor('2026-10-13', today)).toBe(today);
    expect(EVENT_BUFFER_DAYS).toBe(2);
  });
  it('accepts a good plan and takes labels and units from our list, not the form', () => {
    const r = checkPlan({ type: 'wedding', date: '2026-12-20', guests: 150, items: [{ key: 'invitations', qty: 80, label: 'FREE STUFF', unit: 'lies' }], extra: '', notes: 'Cream and gold' }, today, have);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.items[0]).toEqual({ key: 'invitations', label: 'Invitation cards', qty: 80, slug: 'flyers', unit: 'cards' });
      expect(planTitle(r.plan)).toMatch(/^Wedding on /);
      expect(planDetails(r.plan)).toContain('Invitation cards: 80 cards');
    }
  });
  it('refuses today, the past, and a date more than a year away', () => {
    const base = { type: 'wedding', guests: 100, items: [{ key: 'posters', qty: 5 }] };
    for (const date of ['2026-10-12', '2026-10-01', '2027-12-01', 'tomorrow', '']) {
      const r = checkPlan({ ...base, date }, today, have);
      expect(r.ok, date).toBe(false);
      if (!r.ok) expect(r.field).toBe('date');
    }
    expect(checkPlan({ ...base, date: '2027-10-07' }, today, have).ok).toBe(true);
  });
  it('refuses an unknown type, a silly guest count and a bad quantity', () => {
    expect(checkPlan({ type: 'rave', date: '2026-12-20', guests: 10, items: [{ key: 'posters', qty: 1 }] }, today, have).ok).toBe(false);
    expect(checkPlan({ type: 'wedding', date: '2026-12-20', guests: 0, items: [{ key: 'posters', qty: 1 }] }, today, have).ok).toBe(false);
    expect(checkPlan({ type: 'wedding', date: '2026-12-20', guests: 10, items: [{ key: 'posters', qty: -3 }] }, today, have).ok).toBe(false);
    expect(checkPlan({ type: 'wedding', date: '2026-12-20', guests: 10, items: [] }, today, have).ok).toBe(false);
  });
  it('ignores unknown and repeated items, and prices by hand what is not on sale', () => {
    const r = checkPlan({ type: 'church', date: '2026-12-20', guests: 50, items: [{ key: 'posters', qty: 4 }, { key: 'posters', qty: 9 }, { key: 'nonsense', qty: 3 }, { key: 'tshirts', qty: 20 }] }, today, have);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.items.map((i) => i.key)).toEqual(['posters', 'tshirts']);
      expect(r.plan.items[1].slug).toBeNull(); // no T-shirt product on sale here: a person prices it
    }
  });
  it('snaps a quantity up to the next standard step', () => {
    expect(snapQuantity([100, 250, 500], 120)).toBe(250);
    expect(snapQuantity([100, 250, 500], 100)).toBe(100);
    expect(snapQuantity([100, 250, 500], 900)).toBeNull();
    expect(snapQuantity([], 37)).toBe(37);
  });
});

describe('seasonal pages (the parts that need no database)', () => {
  const page = { active: true, starts_on: '2026-12-01', ends_on: '2026-12-24' };
  it('is live from the first day to the last day inclusive', () => {
    expect(phaseOf(page, '2026-11-30')).toBe('upcoming');
    expect(phaseOf(page, '2026-12-01')).toBe('live');
    expect(phaseOf(page, '2026-12-24')).toBe('live');
    expect(phaseOf(page, '2026-12-25')).toBe('ended');
    expect(phaseOf({ ...page, active: false }, '2026-12-10')).toBe('hidden');
    expect(phaseOf({ active: true, starts_on: null, ends_on: null }, '2030-01-01')).toBe('live');
  });
  it('says how long is left in plain words', () => {
    expect(leftText(page, '2026-12-24')).toBe('Last day today');
    expect(leftText(page, '2026-12-23')).toBe('1 day left');
    expect(leftText(page, '2026-12-10')).toBe('14 days left');
    expect(leftText(page, '2026-12-25')).toBeNull();
    expect(leftText({ ends_on: null }, '2026-12-10')).toBeNull();
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
  });
  it('checks dates properly, including ones that do not exist', () => {
    expect(validYmd('2026-12-24')).toBe(true);
    expect(validYmd('2026-02-30')).toBe(false);
    expect(validYmd('24/12/2026')).toBe(false);
    expect(themeOf('burgundy')).toBe('burgundy');
    expect(themeOf('nope')).toBe('ink');
  });
});

describe('delivery windows', () => {
  it('offers none for pickup or when switched off, afternoon only for 24-hour orders, both for standard', () => {
    expect(availableWindows({ speed: 'standard', pickup: true })).toEqual([]);
    expect(availableWindows({ speed: 'standard', pickup: false, enabled: false })).toEqual([]);
    expect(availableWindows({ speed: '24h', pickup: false })).toEqual(['afternoon']);
    expect(availableWindows({ speed: 'standard', pickup: false })).toEqual(['morning', 'afternoon']);
  });
  it('stores the choice as made and works out what applies at read time', () => {
    expect(windowToStore('morning', { pickup: false, enabled: true })).toBe('morning');
    expect(windowToStore('morning', { pickup: true, enabled: true })).toBeNull();
    expect(windowToStore('evening', { pickup: false, enabled: true })).toBeNull();
    expect(effectiveWindow('morning', { speed: '24h', pickup: false })).toBe('afternoon'); // became a 24-hour order
    expect(effectiveWindow('morning', { speed: 'standard', pickup: false })).toBe('morning');
    expect(effectiveWindow('morning', { speed: 'standard', pickup: true })).toBeNull();
    expect(windowText('afternoon')).toBe('Afternoon (1pm to 5pm)');
  });
});

describe('rider link helpers', () => {
  it('accepts only real positions', () => {
    expect(validPos({ lat: 6.5244, lng: 3.3792 })).toBe(true);
    expect(validPos({ lat: '6.5', lng: '3.4' })).toBe(true);
    for (const bad of [null, {}, { lat: 91, lng: 3 }, { lat: 6, lng: 181 }, { lat: 0, lng: 0 }, { lat: 'x', lng: 3 }, { lat: NaN, lng: 3 }]) expect(validPos(bad), JSON.stringify(bad)).toBe(false);
  });
  it('builds a map link and a WhatsApp link that carries the private page', () => {
    expect(mapLink(6.52441, 3.37921)).toBe('https://www.google.com/maps?q=6.52441,3.37921');
    const w = riderWhatsAppLink('08031234567', 'https://brandit.ng/rider/abc', 'BR-1001')!;
    expect(w).toMatch(/^https:\/\/wa\.me\/2348031234567\?text=/);
    expect(decodeURIComponent(w)).toContain('https://brandit.ng/rider/abc');
    expect(riderWhatsAppLink('12', 'x', 'y')).toBeNull();
    expect(riderWhatsAppLink(null, 'x', 'y')).toBeNull();
  });
  it('checks the shape of a rider token', () => {
    expect(validRiderToken('A'.repeat(24))).toBe(true);
    expect(validRiderToken('short')).toBe(false);
    expect(validRiderToken('../etc/passwd'.padEnd(24, 'x'))).toBe(false);
  });
});

describe('brand kit input', () => {
  it('normalises colours', () => {
    expect(normalizeHex('#0b1f33')).toBe('#0B1F33');
    expect(normalizeHex('fc0')).toBe('#FFCC00');
    expect(normalizeHex('blue')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
  });
  it('accepts a website as people type it and refuses other schemes', () => {
    expect(normalizeWebsite('brand.ng')).toBe('brand.ng');
    expect(normalizeWebsite('https://brand.ng/shop')).toBe('https://brand.ng/shop');
    expect(normalizeWebsite('javascript:alert(1)')).toBeNull();
    expect(normalizeWebsite('not a site')).toBeNull();
    expect(normalizeWebsite('')).toBeNull();
  });
});

describe('Pidgin', () => {
  const keys = Object.keys(TEMPLATES) as TemplateKey[];
  const sample = (k: TemplateKey) => Object.fromEntries(TEMPLATES[k].vars.map((v) => [v, `«${v}»`]));
  it('has Pidgin for every customer message, using exactly the same variables as the English', () => {
    for (const k of keys) {
      const en = render(k, sample(k), 'en');
      const pcm = render(k, sample(k), 'pcm');
      for (const v of TEMPLATES[k].vars) {
        expect(en, `${k} English uses ${v}`).toContain(`«${v}»`);
        if (!STAFF_TEMPLATES.includes(k)) expect(pcm, `${k} Pidgin uses ${v}`).toContain(`«${v}»`);
      }
      expect(pcm).not.toContain('undefined');
      if (!STAFF_TEMPLATES.includes(k)) expect(pcm, `${k} is actually different`).not.toBe(en);
    }
  });
  it('keeps our own team\'s messages in English', () => {
    for (const k of STAFF_TEMPLATES) expect(render(k, sample(k), 'pcm')).toBe(render(k, sample(k), 'en'));
  });
  it('falls back to English for a sentence it does not know, and fills in values', () => {
    const t = translator('pcm');
    expect(t('A sentence nobody translated')).toBe('A sentence nobody translated');
    expect(translator('en')('Pay now')).toBe('Pay now');
    expect(translator('en')('Hello {name}', { name: 'Ada' })).toBe('Hello Ada');
  });
  it('has the same {placeholders} on both sides of every UI sentence', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const [en, pcm] of Object.entries(PIDGIN_UI)) {
      expect(ph(pcm), en).toBe(ph(en));
      expect(en, 'no stray spaces in a key').toBe(en.trim());
    }
  });
});
