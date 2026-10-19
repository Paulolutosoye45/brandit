import type { ProductOption } from '@/lib/types';

export type Size = { key: string; label: string };
export type PackageDTO = { key: string; label: string; tagline?: string; badge?: string; set: Record<string, string> };
export type ProductDTO = {
  slug: string;
  name: string;
  blurb: string;
  mode: 'tier' | 'area' | 'size';
  options: ProductOption[];
  sizes: Size[];
  allowCustom: boolean;
  images: { id: string; alt: string }[];
  packages: PackageDTO[];
  qty: { custom: boolean; min: number | null; max: number | null };
  /** Staff looking before it is on sale: nothing can be ordered. */
  preview: boolean;
};
export type Zone = { id: string; name: string; areas: string[] };
export type KitAsset = { id: string; title: string; kind: string; pdf: boolean; thumb: boolean };

/** What the artwork part of the builder needs. */
export type StudioTierOffer = { priceKobo: number; creditKobo: number; feeKobo: number };

export type ArtworkConfig = {
  maxUploadMb: number;
  designFeeKobo: number;
  fixFeeKobo: number;
  isFrame: boolean;
  kit: { name: string | null; assets: KitAsset[] } | null;
  /** Brandit Studio is open to this customer: the starting price in kobo. */
  studioFromKobo: number | null;
  /** What each Studio design costs on the order, and the print credit that comes off it. Only the tiers that are switched on. */
  studio: { standard: StudioTierOffer | null; premium: StudioTierOffer | null } | null;
};

export type BuilderData = {
  product: ProductDTO;
  quantities: number[];
  zones: Zone[];
  whatsapp: string | null;
  defaultArea: string | null;
  artwork: ArtworkConfig;
  signedIn: boolean;
  /** A line already in this browser's basket that the builder should pick up: the one asked for, or an unfinished one for this product. */
  existing: ExistingLine | null;
};

/** A line that already exists in the basket, handed to the builder to change it. */
export type ExistingLine = {
  orderId: string;
  itemId: string;
  quantity: number;
  config: Record<string, string>;
  sizeKey: string | null;
  widthFt: number | null;
  heightFt: number | null;
  area: string | null;
  pickup: boolean;
  artworkPath: 'upload' | 'design' | 'studio' | null;
  /** For a Studio line: the design in My designs it is linked to, and the tier the customer chose (empty until they choose). */
  studio: { projectId: string | null; tier: 'standard' | 'premium' | null; feeKobo: number } | null;
  artworkName: string | null;
  artworkFileId: string | null;
  artworkOriginalFileId: string | null;
  artworkPdf: boolean;
  approved: boolean;
  check: { status: 'pass' | 'warn' | 'stop'; headline: string; lines: { id: string; status: string; label: string; message: string; action?: string }[] } | null;
};

/** One product as the quick order, the search and the product picker list it. */
export type QuickProduct = { slug: string; name: string; from: string; cover: string | null; coverAlt: string; category: string; fast: boolean };
