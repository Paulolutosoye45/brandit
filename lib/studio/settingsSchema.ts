import type { Settings } from '../settings-defaults';
import { ENGINE_IDS } from './providers/catalog';

/*
 * Every Studio setting the console can change, with how it is shown and how it is checked. One table drives both the
 * form and the saving, so a setting cannot be shown but not validated. A mistake becomes a plain message, never a broken Studio.
 */
type Base = { key: keyof Settings; label: string; help?: string };
export type Field =
  | (Base & { kind: 'bool' })
  | (Base & { kind: 'naira'; min?: number; max?: number })
  | (Base & { kind: 'int'; min: number; max: number })
  | (Base & { kind: 'float'; min: number; max: number })
  | (Base & { kind: 'select'; options: [string, string][] })
  | (Base & { kind: 'text'; max: number; multiline?: boolean })
  | (Base & { kind: 'engines' })
  | (Base & { kind: 'json'; valueType: 'string' | 'number' });
export type Group = { id: string; title: string; blurb?: string; fields: Field[] };

export const STUDIO_GROUPS: Group[] = [
  { id: 'switches', title: 'Switches', blurb: 'Turn Studio, or one tier, off at once. People with a design in progress keep what they paid for.', fields: [
    { key: 'studio_enabled', kind: 'bool', label: 'Studio is open', help: 'Off hides Studio from the site and stops new work.' },
    { key: 'studio_standard_on', kind: 'bool', label: 'Standard designs on' },
    { key: 'studio_premium_on', kind: 'bool', label: 'Premium designs on' },
    { key: 'studio_access', kind: 'select', label: 'Who can use Studio', options: [['invited', 'Only people on the invite list'], ['everyone', 'Everyone']], help: 'Start with the invite list. Switch to everyone when the numbers on the overview page look right.' },
  ] },
  { id: 'prices', title: 'Prices (₦, VAT included)', fields: [
    { key: 'studio_standard_kobo', kind: 'naira', label: 'Standard design', min: 0 },
    { key: 'studio_premium_kobo', kind: 'naira', label: 'Premium design', min: 0 },
    { key: 'studio_pack3_kobo', kind: 'naira', label: 'Pack of three Standard designs', min: 0 },
    { key: 'studio_round_standard_kobo', kind: 'naira', label: 'Extra round of changes (Standard)', min: 0 },
    { key: 'studio_round_premium_kobo', kind: 'naira', label: 'Extra edit round (Premium)', min: 0 },
    { key: 'studio_vector_kobo', kind: 'naira', label: 'Vector file (Standard)', min: 0 },
    { key: 'studio_check_kobo', kind: 'naira', label: 'Check by a Brandit designer (Standard)', min: 0 },
    { key: 'studio_credit_standard_kobo', kind: 'naira', label: 'Print credit, Standard', min: 0, help: 'Comes off the Brandit print order that uses the design.' },
    { key: 'studio_credit_premium_kobo', kind: 'naira', label: 'Print credit, Premium', min: 0 },
    { key: 'studio_credit_days', kind: 'int', label: 'Days the print credit lasts', min: 1, max: 365 },
  ] },
  { id: 'allowances', title: 'What each tier includes', fields: [
    { key: 'studio_std_concepts', kind: 'int', label: 'Standard: designs to choose from', min: 1, max: 12 },
    { key: 'studio_std_rounds', kind: 'int', label: 'Standard: rounds of changes', min: 0, max: 10 },
    { key: 'studio_std_per_round', kind: 'int', label: 'Standard: new versions per round', min: 1, max: 6 },
    { key: 'studio_prem_drafts', kind: 'int', label: 'Premium: drafts', min: 1, max: 12 },
    { key: 'studio_prem_finals', kind: 'int', label: 'Premium: finished designs', min: 1, max: 6 },
    { key: 'studio_prem_rounds', kind: 'int', label: 'Premium: edit rounds', min: 0, max: 10 },
    { key: 'studio_prem_extra_products', kind: 'int', label: 'Premium: same look on other products', min: 0, max: 6 },
    { key: 'studio_finish_limit', kind: 'int', label: 'Most print files one design can build', min: 1, max: 40, help: 'Stops a loop from running up cost.' },
    { key: 'studio_standard_max_mp', kind: 'float', label: 'Largest print Standard is guaranteed for (megapixels)', min: 1, max: 64, help: 'Above this, the customer is asked to choose Premium.' },
  ] },
  { id: 'free', title: 'Free sketches and safety', fields: [
    { key: 'studio_free_per_week', kind: 'int', label: 'Free sketches per verified phone number per week', min: 0, max: 20 },
    { key: 'studio_free_ceiling_kobo', kind: 'naira', label: 'Most the free sketches may cost in one day (₦)', min: 0, help: 'Free sketches rest for the rest of the day when this is reached.' },
    { key: 'studio_strike_limit', kind: 'int', label: 'Stopped requests before an account is paused', min: 1, max: 20 },
    { key: 'studio_safe_margin_pct', kind: 'float', label: 'Words stay this far inside the edge (%)', min: 2, max: 12 },
    { key: 'studio_blocklist_extra', kind: 'text', max: 4000, multiline: true, label: 'Extra words and phrases to refuse', help: 'One per line. Added to the built-in content rules.' },
    { key: 'studio_keep_days', kind: 'int', label: 'Days we keep a design after its last activity', min: 7, max: 180, help: 'The privacy page tells customers this number.' },
  ] },
  { id: 'checks', title: 'Human checks', fields: [
    { key: 'studio_review_mode', kind: 'select', label: 'How many results a person looks at', options: [['all', 'Every paid design (recommended while launching)'], ['sample', 'About one in five'], ['off', 'None']] },
    { key: 'studio_check_daily_cap', kind: 'int', label: 'Most Premium checks a day', min: 0, max: 500, help: 'Past this, customers are told the check may take until the next working day.' },
    { key: 'studio_check_hours', kind: 'text', max: 80, label: 'Hours we tell customers a check happens' },
  ] },
  { id: 'money', title: 'Spend and margin', fields: [
    { key: 'studio_vendor_cap_usd', kind: 'float', label: 'Monthly spend on image companies (US dollars)', min: 0, max: 100000, help: 'Free sketches pause at 80 percent. New work pauses at 100 percent. 0 means no cap.' },
    { key: 'studio_margin_floor_pct', kind: 'float', label: 'Margin floor (%)', min: 0, max: 95, help: 'The overview warns when a tier falls below this at full use.' },
    { key: 'studio_fx', kind: 'float', label: 'Naira per dollar, for the cost ledger', min: 100, max: 10000 },
    { key: 'studio_fx_plan', kind: 'float', label: 'Naira per dollar, cautious rate for planning', min: 100, max: 10000 },
  ] },
  { id: 'engines', title: 'Picture makers', blurb: 'Which company makes the pictures, in order. If the first fails or is not connected, the next is tried. Names and prices are settings because companies change them.', fields: [
    { key: 'studio_chain_sketch', kind: 'engines', label: 'Free sketches' },
    { key: 'studio_chain_standard', kind: 'engines', label: 'Standard designs' },
    { key: 'studio_chain_premium', kind: 'engines', label: 'Premium designs' },
    { key: 'studio_upscaler', kind: 'select', label: 'Enlarging for print', options: [['topaz', 'Topaz (best, costs by size)'], ['recraft-crisp', 'Recraft Crisp (cheap)'], ['local', 'Brandit server only (free, softer)']] },
    { key: 'studio_models', kind: 'json', valueType: 'string', label: 'Model names (JSON)', help: 'For example {"recraft": "recraftv4"}. Leave {} to use the built-in names.' },
    { key: 'studio_price_overrides', kind: 'json', valueType: 'number', label: 'Price overrides (JSON, US dollars per picture)', help: 'For example {"recraft": 0.04}. Customer prices can be set here too as "price:standard": 250000 (kobo).' },
  ] },
];

export const ALL_FIELDS = STUDIO_GROUPS.flatMap((g) => g.fields);

/** The value as a string for the form. */
export function toInput(f: Field, s: Settings): string {
  const v = s[f.key] as unknown;
  switch (f.kind) {
    case 'bool': return v ? 'on' : '';
    case 'naira': return String(Number(v) / 100);
    case 'engines': return (v as string[]).join(', ');
    case 'json': return JSON.stringify(v ?? {}, null, 2);
    default: return String(v ?? '');
  }
}

export type Parsed = { ok: true; values: Partial<Settings> } | { ok: false; error: string };

/** Read a submitted form into valid settings, or say what is wrong in plain words. */
export function parseStudioForm(get: (name: string) => string | null, only?: string[]): Parsed {
  const values: Record<string, unknown> = {};
  for (const f of ALL_FIELDS) {
    if (only && !only.includes(f.key as string)) continue;
    const raw = get(f.key as string);
    switch (f.kind) {
      case 'bool': values[f.key] = raw === 'on'; break;
      case 'naira': {
        // "₦2,500" and "2 500" are fine. A minus sign, letters or a second dot are not: never guess what was meant by "-5".
        const t = String(raw ?? '').replace(/[₦,\s]/g, '');
        if (/^-/.test(t)) return { ok: false, error: `${f.label} cannot be negative.` };
        if (!/^\d+(\.\d{1,2})?$/.test(t)) return { ok: false, error: `${f.label}: enter an amount in naira.` };
        const n = Number(t);
        if (f.min != null && n * 100 < f.min) return { ok: false, error: `${f.label} cannot be negative.` };
        values[f.key] = Math.round(n * 100); break;
      }
      case 'int': case 'float': {
        const n = Number(String(raw ?? '').trim());
        if (!Number.isFinite(n) || raw === null || raw.trim() === '') return { ok: false, error: `${f.label}: enter a number.` };
        if (f.kind === 'int' && !Number.isInteger(n)) return { ok: false, error: `${f.label}: use a whole number.` };
        if (n < f.min || n > f.max) return { ok: false, error: `${f.label} must be between ${f.min} and ${f.max}.` };
        values[f.key] = n; break;
      }
      case 'select': {
        if (!f.options.some(([v]) => v === raw)) return { ok: false, error: `${f.label}: choose one of the options.` };
        values[f.key] = raw; break;
      }
      case 'text': {
        const t = String(raw ?? '').replace(/\r/g, '').trim();
        if (t.length > f.max) return { ok: false, error: `${f.label} is too long.` };
        values[f.key] = f.multiline ? t : t.replace(/\s+/g, ' '); break;
      }
      case 'engines': {
        const ids = String(raw ?? '').split(/[\s,]+/).filter(Boolean);
        if (ids.length === 0) return { ok: false, error: `${f.label}: list at least one picture maker.` };
        const bad = ids.find((i) => !(ENGINE_IDS as string[]).includes(i));
        if (bad) return { ok: false, error: `${f.label}: "${bad}" is not a picture maker. Use: ${ENGINE_IDS.join(', ')}.` };
        values[f.key] = ids; break;
      }
      case 'json': {
        let o: unknown;
        try { o = JSON.parse(String(raw ?? '{}') || '{}'); } catch { return { ok: false, error: `${f.label}: that is not valid JSON.` }; }
        if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: `${f.label}: must be an object like {"name": "value"}.` };
        for (const [k, val] of Object.entries(o as Record<string, unknown>)) {
          if (typeof val !== f.valueType || (f.valueType === 'number' && (!Number.isFinite(val as number) || (val as number) < 0))) return { ok: false, error: `${f.label}: "${k}" must be a ${f.valueType === 'number' ? 'positive number' : 'text value'}.` };
        }
        values[f.key] = o; break;
      }
    }
  }
  return { ok: true, values: values as Partial<Settings> };
}
