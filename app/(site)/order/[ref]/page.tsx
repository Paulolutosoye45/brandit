import { notFound, redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { getProduct } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

/**
 * Short links. /order/business-cards opens the Order Builder on business cards, and the options in the link
 * (?package=standard, ?q=250) are chosen when it opens: a link to paste into WhatsApp or print on a card.
 * The same address also works with an order's own id or tracking code, so nothing that was ever shared goes nowhere.
 */
export default async function ShortLink(props: { params: Promise<{ ref: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ref } = await props.params;
  const sp = await props.searchParams;
  const slug = ref.toLowerCase();
  if (/^[a-z0-9-]{1,80}$/.test(slug) && !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(slug)) {
    const p = await getProduct(slug);
    if (p && p.active) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(sp)) { const x = Array.isArray(v) ? v[0] : v; if (x && /^[\w.\-:,]{1,120}$/.test(x) && k !== 'preview' && k !== 'line') qs.set(k, x); }
      qs.set('from', 'link');
      redirect(`/products/${p.slug}?${qs}`);
    }
  }
  // An order's own address: where it is now.
  const o = await one<any>('select id, status, public_token from orders where id::text = $1 or public_token = $1', [ref]);
  if (!o) notFound();
  if (['draft', 'awaiting_payment'].includes(o.status)) redirect(`/checkout/${o.id}`);
  redirect(`/track/${o.public_token}`);
}
