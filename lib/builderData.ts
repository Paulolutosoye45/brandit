import { getBusiness } from '@/lib/business';
import { getProduct, listZones, productImages, quantitySteps } from './catalog';
import { publicOptions } from './priceEngine';
import { getCustomer } from './session';
import { getSettings } from './settings';
import { brandKitFor, listAssets } from './brandKit';
import { accessFor, allowanceFor, priceOf, runnable, tierOn } from './studio/config';
import { studioFeeKobo } from './studio/fees';
import { buildSpec, isSpecError } from './studio/specs';
import type { BuilderData, ExistingLine } from '@/components/builder/types';
import { currentBasket, viewOf } from './basket';
import { one } from './db';
import type { ProductOption } from './types';

/** The options as staff see them in preview: everything, minus what it costs us. */
const stripCosts = (options: ProductOption[]) => options.map((o) => ({ ...o, choices: o.choices.map(({ cost_kobo: _a, cost_per: _b, ...c }) => c) }));

/**
 * Everything the Order Builder needs to run for one product, on the product page or in the panel.
 * Customers get only what they can buy and nothing about cost. Staff in preview also see what is not on sale yet.
 */
export async function builderData(slug: string, opts: { preview?: boolean; lineId?: string | null } = {}): Promise<BuilderData | null> {
  const preview = !!opts.preview;
  const p = await getProduct(slug);
  if (!p || (!p.active && !preview)) return null;
  if (p.sample) return null; // the sample pack has its own card: no choices and no artwork
  const [zones, quantities, me, images, s] = await Promise.all([listZones(), quantitySteps(p.id), getCustomer().catch(() => null), productImages(p.id), getSettings()]);
  const [kitRow, kitAssets] = me && p.slug !== 'id-cards' ? await Promise.all([brandKitFor(me.id), listAssets(me.id)]) : [null, []];
  const kit = me && (kitRow || kitAssets.length > 0) && p.slug !== 'id-cards'
    ? { name: kitRow?.display_name ?? null, assets: kitAssets.map((a) => ({ id: a.id, title: a.title, kind: a.kind, pdf: a.mime === 'application/pdf', thumb: a.has_thumb })) }
    : null;
  // Studio shows for anyone while it is open; a guest is asked to sign in when they pick it. A signed-in customer who has been paused or is not invited does not see it.
  const studioMakes = !isSpecError(buildSpec(p, { sizeKey: p.sizes[0]?.key ?? null, widthFt: p.pricing_mode === 'area' ? 4 : null, heightFt: p.pricing_mode === 'area' ? 3 : null }, s));
  const studioOpen = s.studio_enabled && runnable() && p.slug !== 'id-cards' && studioMakes ? (me ? (await accessFor(s, me as any)).ok : (await accessFor(s, null)).ok) : false;
  const offer = (t: 'standard' | 'premium') => (tierOn(s, t) ? { priceKobo: priceOf(s, t), creditKobo: allowanceFor(t, s).creditKobo, feeKobo: studioFeeKobo(s, t) } : null);
  const studioOffers = studioOpen ? { standard: offer('standard'), premium: offer('premium') } : null;
  // Pick up where the customer left off: the line they asked to change, or one for this product they did not finish.
  let existing: ExistingLine | null = null;
  if (!preview) {
    const basket = await currentBasket().catch(() => null);
    const view = basket ? await viewOf(basket.id).catch(() => null) : null;
    const line = view ? (opts.lineId ? view.lines.find((l) => l.id === opts.lineId && l.slug === p.slug) : view.lines.find((l) => l.slug === p.slug && !l.ready)) ?? null : null;
    if (view && line) {
      const file = line.artworkFileId ? await one<any>('select mime, check_result from files where id = $1', [line.artworkFileId]) : null;
      existing = {
        orderId: view.orderId, itemId: line.id, quantity: line.quantity, config: line.config, sizeKey: line.sizeKey, widthFt: line.widthFt, heightFt: line.heightFt,
        area: view.area, pickup: view.pickup, artworkPath: line.artworkPath, studio: line.artworkPath === 'studio' ? { projectId: line.studioProjectId, tier: line.studioTier, feeKobo: line.designKobo } : null, artworkName: line.artworkName, artworkFileId: line.artworkFileId, artworkOriginalFileId: line.artworkOriginalFileId,
        artworkPdf: file?.mime === 'application/pdf', approved: line.approved, check: file?.check_result ?? null,
      };
    }
  }
  return {
    existing,
    product: {
      slug: p.slug, name: p.name, blurb: p.blurb, mode: p.pricing_mode,
      options: preview ? stripCosts(p.options) : publicOptions(p.options),
      sizes: p.sizes.map((x) => ({ key: x.key, label: x.label })), allowCustom: p.allow_custom, images: images.map((i) => ({ id: i.id, alt: i.alt })),
      packages: (p.packages ?? []).map((g) => ({ key: g.key, label: g.label, tagline: g.tagline, badge: g.badge, set: g.set })),
      qty: { custom: p.qty_custom, min: p.qty_min, max: p.qty_max },
      preview,
    },
    quantities,
    zones: zones.map((z) => ({ id: z.id, name: z.name, areas: z.areas })),
    whatsapp: (await getBusiness()).whatsapp,
    defaultArea: me?.default_area ?? null,
    artwork: {
      maxUploadMb: s.max_upload_mb, designFeeKobo: s.design_fee_kobo, fixFeeKobo: s.fix_fee_kobo, isFrame: p.slug === 'picture-frames',
      kit, studioFromKobo: studioOffers && (studioOffers.standard || studioOffers.premium) ? priceOf(s, studioOffers.standard ? 'standard' : 'premium') : null, studio: studioOffers && (studioOffers.standard || studioOffers.premium) ? studioOffers : null,
    },
    signedIn: !!me,
  };
}
