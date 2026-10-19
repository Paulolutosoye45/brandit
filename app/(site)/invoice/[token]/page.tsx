import { notFound } from 'next/navigation';
import { one, query } from '@/lib/db';
import { naira } from '@/lib/money';
import { describeWhen } from '@/lib/time';
import { getSettings } from '@/lib/settings';
import { PrintButton } from '@/components/PrintButton';
import { Logo } from '@/components/Logo';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Receipt' };

export default async function Invoice(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const o = await one<any>(
    `select o.*, c.name as cname, coalesce(c.whatsapp_phone, c.phone) as phone, c.email, b.name as company, b.tax_id
     from orders o left join customers c on c.id = o.customer_id left join businesses b on b.id = o.business_id where o.public_token = $1`,
    [params.token],
  );
  if (!o) notFound();
  const lines = await query<any>(
    `select i.quantity, i.width_ft, i.height_ft, i.size_key, i.line_total_kobo, coalesce(i.label, p.name) as product_name, p.sizes
     from order_items i join products p on p.id = i.product_id where i.order_id = $1 order by i.position, i.id`, [o.id]);
  const s = await getSettings();
  const paid = !!o.paid_at;
  const title = paid ? (o.company ? 'VAT invoice' : 'Receipt') : 'Pro-forma invoice';
  const rate = s.vat_rate;
  const base = o.subtotal_kobo + o.delivery_fee_kobo + o.design_fee_kobo;
  const net = o.total_kobo - o.vat_kobo;
  return (
    <div className="mx-auto max-w-[760px] px-5 py-8 grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><Logo className="h-11 w-auto" /><p className="text-muted text-[14px]">A Cerebre Media Africa company, Lagos</p></div>
        <div className="text-right"><h1 className="font-display font-extrabold text-[28px]">{title}</h1><p className="text-muted text-[14px]">Order {o.code}</p><p className="text-muted text-[14px]">{describeWhen(new Date(paid ? o.paid_at : o.created_at))}</p></div>
      </div>
      <div className="grid sm:grid-cols-2 gap-4 text-[15px]">
        <div><p className="font-bold">Billed to</p><p>{o.company ?? o.cname ?? '—'}</p>{o.company && o.cname && <p>{o.cname}</p>}{o.tax_id && <p>Tax ID {o.tax_id}</p>}<p>{o.phone}</p><p>{o.email}</p></div>
        <div><p className="font-bold">{paid ? 'Paid' : 'To pay'}</p><p>{paid ? 'Thank you.' : 'Pay on Brandit with card, bank transfer or USSD. This pro-forma is for your internal approval.'}</p></div>
      </div>
      <table className="w-full text-[15px] tabular">
        <thead><tr className="text-left border-b-2 border-ink"><th className="py-2">Item</th><th className="py-2 text-right">Amount</th></tr></thead>
        <tbody>
          {lines.map((l, n) => {
            const size = (l.sizes as any[]).find((x) => x.key === l.size_key);
            return (
              <tr key={n} className="border-b border-line"><td className="py-2">{o.custom_request_id ? '' : `${l.quantity.toLocaleString('en-US')} × `}{l.product_name}{l.width_ft ? ` (${l.width_ft} × ${l.height_ft} ft)` : size && (l.sizes as any[]).length > 1 ? ` (${size.label})` : ''}</td><td className="py-2 text-right">{naira(lines.length === 1 ? o.subtotal_kobo : l.line_total_kobo)}</td></tr>
            );
          })}
          {o.design_fee_kobo > 0 && <tr className="border-b border-line"><td className="py-2">Design fee</td><td className="py-2 text-right">{naira(o.design_fee_kobo)}</td></tr>}
          <tr className="border-b border-line"><td className="py-2">{o.pickup ? 'Pickup' : 'Delivery'}</td><td className="py-2 text-right">{o.pickup ? 'Free' : naira(o.delivery_fee_kobo)}</td></tr>
          {o.discount_kobo > 0 && <tr className="border-b border-line"><td className="py-2">Coupon {o.coupon_code}</td><td className="py-2 text-right">−{naira(o.discount_kobo)}</td></tr>}
        </tbody>
        <tfoot>
          <tr><td className="pt-3 text-right text-muted">Amount before VAT</td><td className="pt-3 text-right">{naira(net)}</td></tr>
          <tr><td className="text-right text-muted">VAT ({(rate * 100).toFixed(1)}%)</td><td className="text-right">{naira(o.vat_kobo)}</td></tr>
          <tr className="font-bold text-[18px]"><td className="pt-2 text-right">Total{base - (o.discount_kobo ?? 0) === o.total_kobo ? ' (VAT included)' : ''}</td><td className="pt-2 text-right">{naira(o.total_kobo)}</td></tr>
        </tfoot>
      </table>
      <div className="flex gap-3 items-center"><PrintButton label="Print or save as PDF" /></div>
    </div>
  );
}
