export type PricingMode = 'tier' | 'area' | 'size';
export type CheckClass = 'print' | 'photo' | 'large';

/** A choice can add to the price: once per order, once per piece, or once per square foot (banners). */
export type ExtraPer = 'order' | 'piece' | 'sqft';
export type OptionChoice = { value: string; label: string; extra_kobo?: number; extra_per?: ExtraPer };
export type ProductOption = {
  key: string;
  label: string;
  default: string;
  choices: OptionChoice[];
  help?: string;
};
export type SizeOption = { key: string; label: string; w_in: number; h_in: number };

export type Product = {
  id: string;
  slug: string;
  name: string;
  blurb: string;
  pricing_mode: PricingMode;
  options: ProductOption[];
  sizes: SizeOption[];
  print_w_in: number | null;
  print_h_in: number | null;
  check_class: CheckClass;
  active: boolean;
  sort: number;
  description: string;
  highlights: string[];
  category: string;
  allow_custom: boolean;
};

export type Zone = { id: string; name: string; areas: string[]; fee_kobo: number; eligible_24h: boolean; sort: number; provisional: boolean };

export const STAGES = ['paid', 'file_check', 'proof', 'printing', 'quality_check', 'out_for_delivery', 'delivered'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  paid: 'Paid',
  file_check: 'File check',
  proof: 'Proof',
  printing: 'Printing',
  quality_check: 'Quality check',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

export type Role = 'admin' | 'production_lead' | 'file_desk' | 'support' | 'dispatcher' | 'partner_press';
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  production_lead: 'Production lead',
  file_desk: 'File desk',
  support: 'Support',
  dispatcher: 'Dispatcher',
  partner_press: 'Partner press',
};
