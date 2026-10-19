import { one, query } from '../db';
import { getSettings } from '../settings';
import type { Settings } from '../settings-defaults';
import type { Customer } from '../identity';
import { occasionById } from '../../content/studio';
import {
  assetsOf, briefOf, getProject, humanCheckNeeded, readyToOrder, reviewState, specOf, usageOf, versionsOf,
  type Asset, type Project, type Version,
} from './projects';
import { accessFor, naira, priceOf, studioPublicStatus, tierOn } from './config';
import { sketchState } from './limits';
import { capState } from './ledger';
import { walletOf } from './purchases';
import { lineOf } from './inOrder';
import { studioFeeKobo } from './fees';
import { appUrl } from '../messages';
import type { Spec } from './specs';

/*
 * What the browser is told about a design. Never a storage key, never a vendor name, never what a picture cost. Pictures
 * are addressed by version id and checked against the signed-in customer (or the share link) every time they are fetched.
 */
export type VersionView = {
  id: string;
  kind: Version['kind'];
  label: string;
  idx: number;
  round: number;
  status: Version['status'];
  free: boolean;
  note: string | null;
  parentId: string | null;
  preview: string | null;
  w: number | null;
  h: number | null;
  error: string | null;
  finish: { status: Version['finish_status']; error: string | null };
  check: { status: 'pass' | 'warn' | 'stop'; headline: string; lines: { id: string; status: string; label: string; message: string }[]; options: { id: string; label: string }[]; sizes: string[]; dpi: number | null } | null;
  spec: { label: string; slug: string } | null;
  vector: 'none' | 'queued' | 'running' | 'done' | 'failed';
  files: { png: boolean; pdf: boolean; svg: boolean };
  locked: boolean;
  approved: boolean;
  createdAt: string;
  brief: { lines: Record<string, string>; choices: any; look: string; palette: string; style: string } | null;
};

export type AssetView = { id: string; kind: 'photo' | 'logo'; title: string; w: number | null; h: number | null; url: string; colours: string[]; theme: any };

const KIND_LABEL: Record<Version['kind'], string> = {
  sketch: 'Free sketch', concept: 'Concept', draft: 'Draft', revision: 'Changed', final: 'Premium final', edit: 'Edited', adapt: 'Another product', tweak: 'Words changed',
};

export function versionView(v: Version, p: Pick<Project, 'approved_version_id'>, opts: { vectorAllowed?: boolean } = {}): VersionView {
  const cr = v.check_result;
  const sizes: string[] = Array.isArray(cr?.sizesThatPass) ? cr.sizesThatPass.map((s: any) => String(s.label)).slice(0, 4) : [];
  const vecState = (v.payload?.vector as string | undefined) ?? (v.svg_key ? 'done' : 'none');
  return {
    id: v.id,
    kind: v.kind,
    label: KIND_LABEL[v.kind] ?? 'Design',
    idx: v.idx,
    round: v.round,
    status: v.status,
    free: v.free,
    note: v.note,
    parentId: v.parent_id,
    preview: v.status === 'ready' && v.preview_key ? `/api/studio/v/${v.id}?k=preview` : null,
    w: v.preview_w ?? null,
    h: v.preview_h ?? null,
    error: v.status === 'failed' || v.status === 'blocked' ? (v.user_error ?? 'This design could not be made.') : null,
    finish: { status: v.finish_status, error: v.finish_status === 'failed' ? (v.finish_error ?? 'The print file could not be made. Try again.') : null },
    check: cr && cr.status
      ? { status: cr.status, headline: String(cr.headline ?? ''), lines: Array.isArray(cr.lines) ? cr.lines.map((l: any) => ({ id: String(l.id), status: String(l.status), label: String(l.label), message: String(l.message) })) : [], options: Array.isArray(cr.options) ? cr.options : [], sizes, dpi: cr.dpi ?? null }
      : null,
    spec: v.spec ? { label: (v.spec as Spec).label, slug: (v.spec as Spec).slug } : null,
    vector: (['queued', 'running', 'done', 'failed'].includes(vecState) ? vecState : 'none') as VersionView['vector'],
    files: { png: v.finish_status === 'done' && !!v.final_key && v.kind !== 'sketch', pdf: v.finish_status === 'done' && !!v.pdf_key && v.kind !== 'sketch', svg: !!v.svg_key && !!opts.vectorAllowed },
    locked: !!(v as any).locked_at && v.id === p.approved_version_id,
    approved: v.id === p.approved_version_id,
    createdAt: v.created_at,
    brief: v.layout?.brief ? { lines: v.layout.brief.lines ?? {}, choices: v.layout.brief.choices ?? {}, look: v.layout.brief.look ?? '', palette: v.layout.brief.palette ?? '', style: v.layout.brief.style ?? '' } : null,
  };
}

export function assetView(a: Asset): AssetView {
  return { id: a.id, kind: a.kind as 'photo' | 'logo', title: a.title, w: a.width_px, h: a.height_px, url: `/api/studio/a/${a.id}`, colours: a.palette?.colours ?? [], theme: a.palette?.theme ?? null };
}

export type Prices = {
  standard: string; premium: string; upgrade: string; pack3: string; roundStandard: string; roundPremium: string; vector: string; check: string; creditStandard: string; creditPremium: string;
  kobo: { standard: number; premium: number; upgrade: number; pack3: number; round: number; vector: number; check: number };
};

export function pricesView(s: Settings, tier: 'standard' | 'premium' | null): Prices {
  return {
    standard: naira(priceOf(s, 'standard')), premium: naira(priceOf(s, 'premium')), upgrade: naira(priceOf(s, 'upgrade')), pack3: naira(priceOf(s, 'pack3')),
    roundStandard: naira(priceOf(s, 'round', 'standard')), roundPremium: naira(priceOf(s, 'round', 'premium')), vector: naira(priceOf(s, 'vector')), check: naira(priceOf(s, 'check')),
    creditStandard: naira(s.studio_credit_standard_kobo), creditPremium: naira(s.studio_credit_premium_kobo),
    kobo: { standard: priceOf(s, 'standard'), premium: priceOf(s, 'premium'), upgrade: priceOf(s, 'upgrade'), pack3: priceOf(s, 'pack3'), round: priceOf(s, 'round', tier ?? 'standard'), vector: priceOf(s, 'vector'), check: priceOf(s, 'check') },
  };
}

/** Everything the workspace needs in one go. Called by the page and by the polling endpoint. */
export async function projectView(c: Customer, projectId: string, p0?: Project) {
  const p = p0 ?? (await getProject(projectId));
  if (!p || p.customer_id !== c.id || p.status === 'purged') return null;
  const s = await getSettings();
  const [vs, as, usage, spec, access, wallet, review, sk, cap] = await Promise.all([
    versionsOf(p.id), assetsOf(p.id), usageOf(p, s), specOf(p, s), accessFor(s, c as any), walletOf(c.id), reviewState(p.id), sketchState(s, c), capState(s),
  ]);
  const vectorPurchase = p.tier === 'standard' && p.vector_paid ? await one<{ raw: any }>("select raw from studio_purchases where project_id = $1 and sku = 'vector' and status = 'paid' order by created_at desc limit 1", [p.id]) : null;
  const vectorVersion = (v: Version) => p.tier === 'premium' || (p.tier === 'standard' && p.vector_paid && vectorPurchase?.raw?.versionId === v.id);
  const brief = briefOf(p);
  const occ = occasionById(brief.occasion);
  const feedback = await query<{ id: string; name: string; verdict: string; note: string | null; created_at: string; version_id: string | null }>('select id, name, verdict, note, created_at, version_id from studio_feedback where project_id = $1 order by created_at desc limit 30', [p.id]);
  const ready = await readyToOrder(p);
  const order = p.order_id ? await one<{ id: string; status: string; code: string }>('select id, status, code from orders where id = $1', [p.order_id]) : null;
  const line = await lineOf(p.id);
  const credit = p.credit_coupon_id ? await one<{ code: string; ends_at: string | null; active: boolean; redeemed: number }>('select code, ends_at, active, (select count(*)::int from coupon_redemptions r where r.coupon_id = coupons.id) as redeemed from coupons where id = $1', [p.credit_coupon_id]) : null;
  const sp = 'error' in spec ? null : spec;
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    tier: p.tier,
    fromPack: p.from_pack,
    occasion: { id: occ.id, label: occ.label, lines: occ.lines.map((l) => ({ id: l.id, label: l.label, hint: l.hint, required: !!l.required, example: l.example, max: l.max ?? 140 })), styles: occ.styles },
    brief: { lines: brief.lines, look: brief.look, style: brief.style, palette: brief.palette, choices: brief.choices, qrUrl: brief.qrUrl },
    product: { slug: p.product_slug, sizeKey: p.size_key, widthFt: p.width_ft, heightFt: p.height_ft, quantity: p.quantity, label: sp?.label ?? p.product_slug, needsPremium: !!sp?.needsPremium, shape: sp?.shape ?? 'rect', printW: sp?.printWIn ?? null, printH: sp?.printHIn ?? null, mp: sp ? +sp.mp.toFixed(1) : null },
    consent: !!p.consent_at,
    phoneVerified: !!c.phone,
    assets: as.filter((a) => a.kind === 'photo' || a.kind === 'logo').map(assetView),
    versions: vs.map((v) => versionView(v, p, { vectorAllowed: vectorVersion(v) })),
    usage,
    sketches: { limit: sk.limit, used: sk.used, left: sk.left, nextAt: sk.nextAt, resting: sk.resting },
    wallet: { standardCredits: wallet },
    prices: pricesView(s, p.tier),
    access: access.ok ? { ok: true as const } : { ok: false as const, reason: access.reason, message: access.message },
    busy: cap.state === 'all_off',
    tiers: { standard: tierOn(s, 'standard'), premium: tierOn(s, 'premium') },
    approval: {
      versionId: p.approved_version_id,
      at: p.approved_at,
      sha: p.approved_sha256 ? p.approved_sha256.slice(0, 12) : null,
      humanCheck: humanCheckNeeded(p),
      review: review ? { status: review.status, note: review.note, requestedAt: review.requested_at } : null,
      ready: ready.ok,
      reason: ready.ok ? null : ready.reason,
    },
    vectorPaid: p.vector_paid,
    checkPaid: p.check_paid,
    order: order ? { id: order.id, status: order.status, code: order.code } : null,
    // Set when this design is for a line in an order. While that order is unpaid the design is bought by adding it to the order.
    orderLine: line ? { orderId: line.orderId, code: line.orderCode, status: line.orderStatus, open: ['draft', 'awaiting_payment'].includes(line.orderStatus), tier: line.tier, feeKobo: line.feeKobo, fee: naira(line.feeKobo) } : null,
    fees: { standard: naira(studioFeeKobo(s, 'standard')), premium: naira(studioFeeKobo(s, 'premium')) },
    credit: credit ? { code: credit.code, kobo: p.credit_kobo, endsAt: credit.ends_at, active: credit.active, used: credit.redeemed > 0 } : { code: null, kobo: p.credit_kobo, endsAt: null, active: false, used: false },
    share: { url: `${appUrl()}/studio/share/${p.share_token}`, versionId: p.shared_version_id },
    likedVersionId: p.liked_version_id,
    feedback: feedback.map((f) => ({ id: f.id, name: f.name, verdict: f.verdict, note: f.note, at: f.created_at, versionId: f.version_id })),
    keepUntil: p.delete_after,
    keepDays: s.studio_keep_days,
    creditDays: s.studio_credit_days,
    hours: s.studio_check_hours,
    working: usage.busy > 0 || vs.some((v) => v.finish_status === 'queued' || v.finish_status === 'running' || ['queued', 'running'].includes(String(v.payload?.vector))),
  };
}
export type ProjectView = NonNullable<Awaited<ReturnType<typeof projectView>>>;

export { studioPublicStatus };
