import { requireStaff } from '@/lib/session';
import { query } from '@/lib/db';
import { couponStats, type Coupon } from '@/lib/coupons';
import { couponLabel } from '@/lib/couponCore';
import { stateOf } from '@/lib/couponAdmin';
import { listProducts } from '@/lib/catalog';
import { appUrl } from '@/lib/messages';
import { naira } from '@/lib/money';
import { Notice } from '@/components/Bits';
import { createCouponAction, deleteCouponAction, toggleCouponAction, updateCouponAction } from './actions';
import { CouponForm } from './CouponForm';
import { CopyButton } from './CopyButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Coupons' };

const STATE: Record<string, [string, string]> = {
  active: ['Active', 'bg-good-tint text-good'],
  scheduled: ['Starts later', 'bg-warn-tint text-warn'],
  ended: ['Ended', 'bg-placeholder text-ink'],
  paused: ['Paused', 'bg-placeholder text-ink'],
  used_up: ['All used', 'bg-placeholder text-ink'],
};
const day = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' }) : null);
const ymd = (d: string | Date | null) => (d ? new Date(new Date(d).getTime() + 3_600_000).toISOString().slice(0, 10) : '');

export default async function Coupons(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('manage_coupons');
  const [coupons, stats, products] = await Promise.all([
    query<Coupon>("select * from coupons where source = 'manual' order by created_at desc"),
    couponStats(),
    listProducts(true),
  ]);
  const base = appUrl();
  return (
    <div className="grid gap-8 max-w-[980px]">
      <div><h1 className="text-[34px]">Coupons</h1><p className="text-muted">Give customers a reason to order now. Share the link or the code on WhatsApp, Instagram or a flyer. A code takes money off the print price; it never makes the total negative.</p></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}

      <section id="new" className="card p-5 grid gap-4 scroll-mt-6">
        <h2 className="text-[24px]">Make a coupon</h2>
        <CouponForm products={products.map((p) => ({ id: p.id, name: p.name }))} action={createCouponAction} />
      </section>

      <section id="list" className="grid gap-3 scroll-mt-6">
        <h2 className="text-[24px]">Your coupons</h2>
        {coupons.length === 0 && <div className="card p-8 text-center text-muted">No coupons yet. Make your first one above.</div>}
        {coupons.map((c) => {
          const st = stats.get(c.id);
          const used = st?.redemptions ?? 0;
          const [label, cls] = STATE[stateOf(c, used)];
          const link = `${base}/?code=${encodeURIComponent(c.code)}`;
          return (
            <details key={c.id} className="card group" open={false}>
              <summary className="p-4 sm:p-5 cursor-pointer list-none grid gap-1">
                <span className="flex flex-wrap items-center gap-3"><span className="font-mono text-[20px] font-bold">{c.code}</span><span className={`pill ${cls}`}>{label}</span></span>
                <span className="text-[15px]">{c.description?.trim() || couponLabel(c)}</span>
                <span className="text-[14px] text-muted">Used {used}{c.max_redemptions != null ? ` of ${c.max_redemptions}` : ''} times{st ? ` · ${naira(st.discountKobo)} given away · ${naira(st.revenueKobo)} in orders` : ''}{c.ends_at ? ` · ends ${day(c.ends_at)}` : ''}</span>
              </summary>
              <div className="border-t border-line p-4 sm:p-5 grid gap-4">
                <div className="grid gap-1 text-[15px]">
                  <p><span className="font-bold">Gives:</span> {couponLabel(c)}</p>
                  <p><span className="font-bold">Rules:</span> {c.max_per_customer === 1 ? 'one use per customer' : `${c.max_per_customer} uses per customer`}{c.first_order_only ? ', first orders only' : ''}{c.product_ids.length ? `, ${c.product_ids.length} product${c.product_ids.length === 1 ? '' : 's'} only` : ', every product'}{c.starts_at ? `, from ${day(c.starts_at)}` : ''}</p>
                  <p className="break-all"><span className="font-bold">Share link:</span> <span className="font-mono text-[14px]">{link}</span></p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CopyButton text={link} label="Copy link" />
                  <CopyButton text={c.code} label="Copy code" />
                  <form action={toggleCouponAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="on" value={c.active ? '0' : '1'} /><button className="btn-secondary btn-sm">{c.active ? 'Pause' : 'Turn on'}</button></form>
                  {used === 0 && <form action={deleteCouponAction}><input type="hidden" name="id" value={c.id} /><button className="btn-ghost btn-sm !text-bad">Delete</button></form>}
                </div>
                <form action={updateCouponAction} className="grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_170px_150px_auto] sm:items-end">
                  <input type="hidden" name="id" value={c.id} />
                  <div><label className="label" htmlFor={`d-${c.id}`}>What customers see</label><input id={`d-${c.id}`} name="description" className="field !min-h-[44px]" maxLength={80} defaultValue={c.description} /></div>
                  <div><label className="label" htmlFor={`e-${c.id}`}>Last day</label><input id={`e-${c.id}`} name="ends_on" type="date" className="field !min-h-[44px]" defaultValue={ymd(c.ends_at)} /></div>
                  <div><label className="label" htmlFor={`m-${c.id}`}>Total uses</label><input id={`m-${c.id}`} name="max_redemptions" inputMode="numeric" className="field !min-h-[44px]" defaultValue={c.max_redemptions ?? ''} /></div>
                  <button className="btn-secondary btn-sm">Save changes</button>
                </form>
              </div>
            </details>
          );
        })}
      </section>
    </div>
  );
}
