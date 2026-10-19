import { notFound, redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { getItem, getOrder } from '@/lib/orders';
import { getProductById } from '@/lib/catalog';
import { getSettings } from '@/lib/settings';
import { printDims } from '@/lib/quote';
import { PageHead } from '@/components/Bits';
import { getCustomer } from '@/lib/session';
import { brandKitFor, listAssets } from '@/lib/brandKit';
import { accessFor, priceOf, runnable } from '@/lib/studio/config';
import { ArtworkStep } from './ArtworkStep';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your artwork' };

export default async function ArtworkPage(
  props: { params: Promise<{ ref: string }>; searchParams: Promise<{ fix?: string; item?: string }> }
) {
  const params = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/.test(params.ref)) notFound();
  const o = await getOrder(params.ref);
  const item = o && (await getItem(params.ref, sp.item && /^[0-9a-f-]{36}$/.test(sp.item) ? sp.item : null));
  if (!o || !item) notFound();
  const job = await one('select stage, clock_paused, paused_reason from jobs where order_item_id = $1', [item.id]);
  const fixMode = !!job && job.stage === 'file_check';
  if (!['draft', 'awaiting_payment'].includes(o.status) && !fixMode) redirect(`/track/${o.public_token}`);
  const product = (await getProductById(item.product_id))!;
  const s = await getSettings();
  const dims = printDims(product, item.size_key, item.width_ft, item.height_ft, item.config);
  const size = product.sizes.find((x) => x.key === item.size_key);
  const me = await getCustomer().catch(() => null);
  const [kitRow, kitAssets] = me ? await Promise.all([brandKitFor(me.id), listAssets(me.id)]) : [null, []];
  const kit = me && (kitRow || kitAssets.length > 0) && product.slug !== 'id-cards'
    ? { name: kitRow?.display_name ?? null, assets: kitAssets.map((a) => ({ id: a.id, title: a.title, kind: a.kind, pdf: a.mime === 'application/pdf', thumb: a.has_thumb })) }
    : null;
  const studioOpen = !fixMode && !!me && s.studio_enabled && runnable() && product.slug !== 'id-cards' ? (await accessFor(s, me as any)).ok : false;
  return (
    <>
      <PageHead title={fixMode ? 'Upload a new file' : 'Give us your artwork'} sub={`${item.label ?? product.name} · order ${o.code}`} />
      <ArtworkStep
        orderId={o.id}
        itemId={item.id}
        productName={product.name}
        isFrame={product.slug === 'picture-frames'}
        currentSizeLabel={size && product.sizes.length > 1 ? size.label : item.width_ft ? `${item.width_ft} × ${item.height_ft} ft` : null}
        printW={dims?.w ?? null}
        printH={dims?.h ?? null}
        designFeeKobo={s.design_fee_kobo}
        fixFeeKobo={s.fix_fee_kobo}
        fixMode={fixMode}
        maxUploadMb={s.max_upload_mb}
        flaggedReason={job?.clock_paused ? job.paused_reason : null}
        kit={kit}
        startPath={item.artwork_path === 'design' && !fixMode ? 'design' : 'upload'}
        studio={studioOpen ? { href: `/studio/new?product=${product.slug}&order=${o.id}`, fromKobo: priceOf(s, 'standard') } : null}
      />
    </>
  );
}
