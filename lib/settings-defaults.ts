import type { CheckClass } from './types';

export type Thresholds = Record<CheckClass, { pass: number; warn: number }>;

export type Settings = {
  cutoff_time: string;          // Lagos time, 24h
  arrive_by: string;            // Lagos time, 24h
  daily_24h_slots: number;
  slots_paused: boolean;
  working_days: number[];       // 0 = Sunday
  holidays: string[];           // YYYY-MM-DD
  vat_rate: number;
  prices_include_vat: boolean;
  hold_minutes: number;
  at_risk_qc_hours: number;     // not at quality check this long before promise = at risk
  at_risk_dispatch_hours: number;
  design_fee_kobo: number;
  fix_fee_kobo: number;
  claim_window_hours: number;
  lead_reprint_limit_kobo: number; // production lead can approve alone up to this
  score_min_orders: number;
  check_thresholds: Thresholds;
  max_upload_mb: number;
  id_file_retention_days: number;
  pickup_address: string;         // shown wherever a customer chooses pickup
  custom_reply_hours: number;     // what we tell customers about how fast a custom quote comes back
  custom_quote_valid_days: number;
  nudge_enabled: boolean;         // one friendly reminder for an order that was filled in but not paid
  nudge_after_minutes: number;
  referral_enabled: boolean;
  referral_friend_percent: number;   // what a friend takes off their first order
  referral_friend_cap_kobo: number;  // the most a friend's discount can be
  referral_reward_kobo: number;      // what the person who shared earns when the friend's order is delivered
  referral_reward_days: number;      // how long a reward code stays valid
  referral_max_rewards: number;      // the most rewards one person can earn
  windows_enabled: boolean;       // customers can choose morning or afternoon for delivery
  pidgin_enabled: boolean;        // show the English / Pidgin switch

  // ---- Brandit Studio (AI designs). Every price is whole kobo and includes VAT, like the rest of the site. ----
  studio_enabled: boolean;                 // master switch: off hides Studio and stops new work
  studio_standard_on: boolean;             // kill switch for the Standard tier
  studio_premium_on: boolean;              // kill switch for the Premium tier
  studio_access: 'everyone' | 'invited';   // invited = only people on the invite list (the launch plan). Demo mode is always open.
  studio_standard_kobo: number;
  studio_premium_kobo: number;
  studio_pack3_kobo: number;               // three Standard designs, never expires
  studio_round_standard_kobo: number;      // one more revision round
  studio_round_premium_kobo: number;       // one more edit round
  studio_vector_kobo: number;              // vector file for a Standard design (Premium includes it)
  studio_check_kobo: number;               // a Brandit designer checks a Standard design (Premium includes it)
  studio_credit_standard_kobo: number;     // comes off a Brandit print order that uses the design
  studio_credit_premium_kobo: number;
  studio_credit_days: number;
  studio_std_concepts: number;             // full-quality concepts in Standard
  studio_std_rounds: number;               // revision rounds in Standard
  studio_std_per_round: number;            // new versions per revision round
  studio_prem_drafts: number;
  studio_prem_finals: number;
  studio_prem_rounds: number;              // edit rounds in Premium
  studio_prem_extra_products: number;      // the same look, adapted to other products
  studio_finish_limit: number;             // most print files one project can build (stops loops)
  studio_free_per_week: number;            // free sketches per verified phone number, in any 7 days
  studio_free_ceiling_kobo: number;        // most the free sketches may cost in one Lagos day before they pause
  studio_standard_max_mp: number;          // largest print (in megapixels at the pass level) Standard is guaranteed for
  studio_vendor_cap_usd: number;           // monthly spend on image vendors; free sketches and new sales pause at this
  studio_margin_floor_pct: number;         // the console warns when a tier's margin at full use falls under this
  studio_fx: number;                       // naira per dollar used for the cost ledger
  studio_fx_plan: number;                  // the cautious rate used for the planning margin
  studio_keep_days: number;                // uploads, words and drafts are deleted this long after the last activity
  studio_review_mode: 'all' | 'sample' | 'off'; // how many AI results a person looks at in the console
  studio_check_daily_cap: number;          // most Premium human checks a day
  studio_check_hours: string;              // said to the customer
  studio_strike_limit: number;             // blocked requests in 30 days before Studio pauses on that account
  studio_safe_margin_pct: number;          // words stay this far inside the edge
  studio_blocklist_extra: string;          // one word or phrase per line, added to the built-in content rules
  studio_chain_sketch: string[];           // engines for free sketches, tried in order
  studio_chain_standard: string[];
  studio_chain_premium: string[];
  studio_upscaler: 'topaz' | 'recraft-crisp' | 'local';
  studio_models: Record<string, string>;   // vendor model names, so a rename at the vendor is a setting and not a deploy
  studio_price_overrides: Record<string, number>; // vendor price per call or per megapixel (US dollars), when a vendor changes its rate card
};

// Starting values. Every one is editable in the console and lives in the database.
export const DEFAULT_SETTINGS: Settings = {
  cutoff_time: '12:00',
  arrive_by: '17:00',
  daily_24h_slots: 15,
  slots_paused: false,
  working_days: [1, 2, 3, 4, 5, 6],
  holidays: ['2026-10-01', '2026-12-25', '2026-12-26'],
  vat_rate: 0.075,
  prices_include_vat: true,
  hold_minutes: 15,
  at_risk_qc_hours: 4,
  at_risk_dispatch_hours: 2,
  design_fee_kobo: 1_200_000, // the human "done for you" service, the top rung above Studio: from about N12,000, bigger jobs quoted first
  fix_fee_kobo: 200_000,
  claim_window_hours: 48,
  lead_reprint_limit_kobo: 5_000_000,
  score_min_orders: 30,
  check_thresholds: {
    print: { pass: 300, warn: 150 },
    photo: { pass: 200, warn: 120 },
    large: { pass: 100, warn: 50 },
  },
  max_upload_mb: 90, // keep under 100: Cloudflare's free plan rejects any single request over 100 MB
  id_file_retention_days: 30,
  pickup_address: '',
  custom_reply_hours: 24,
  custom_quote_valid_days: 7,
  nudge_enabled: true,
  nudge_after_minutes: 120,
  referral_enabled: true,
  referral_friend_percent: 10,
  referral_friend_cap_kobo: 500_000,
  referral_reward_kobo: 100_000,
  referral_reward_days: 90,
  referral_max_rewards: 20,
  windows_enabled: true,
  pidgin_enabled: true,

  studio_enabled: true,
  studio_standard_on: true,
  studio_premium_on: true,
  studio_access: 'invited',
  studio_standard_kobo: 250_000,
  studio_premium_kobo: 750_000,
  studio_pack3_kobo: 650_000,
  studio_round_standard_kobo: 50_000,
  studio_round_premium_kobo: 100_000,
  studio_vector_kobo: 100_000,
  studio_check_kobo: 100_000,
  studio_credit_standard_kobo: 100_000,
  studio_credit_premium_kobo: 250_000,
  studio_credit_days: 30,
  studio_std_concepts: 4,
  studio_std_rounds: 2,
  studio_std_per_round: 2,
  studio_prem_drafts: 6,
  studio_prem_finals: 2,
  studio_prem_rounds: 3,
  studio_prem_extra_products: 2,
  studio_finish_limit: 8,
  studio_free_per_week: 2,
  studio_free_ceiling_kobo: 2_000_000,
  studio_standard_max_mp: 13,
  studio_vendor_cap_usd: 300,
  studio_margin_floor_pct: 40,
  studio_fx: 1400,
  studio_fx_plan: 1700,
  studio_keep_days: 30,
  studio_review_mode: 'all',
  studio_check_daily_cap: 30,
  studio_check_hours: 'Monday to Saturday, 9am to 5pm',
  studio_strike_limit: 3,
  studio_safe_margin_pct: 5,
  studio_blocklist_extra: '',
  studio_chain_sketch: ['recraft-flash', 'flux'],
  studio_chain_standard: ['recraft', 'flux'],
  studio_chain_premium: ['nano-banana', 'gpt-image', 'recraft-pro'],
  studio_upscaler: 'topaz',
  studio_models: {},
  studio_price_overrides: {},
};
