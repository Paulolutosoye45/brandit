'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { CouponError, createCoupon, deleteCoupon, setCouponActive, updateCouponLimits } from '@/lib/couponAdmin';
import { trail, trailProduct } from '@/lib/trail';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
function back(msg: { e?: string; ok?: string }, hash = ''): never {
  revalidatePath('/console/coupons');
  redirect(`/console/coupons?${msg.e ? `e=${encodeURIComponent(msg.e)}` : `ok=${encodeURIComponent(msg.ok ?? 'Saved.')}`}${hash}`);
}
async function run(ok: string, hash: string, fn: () => Promise<unknown>): Promise<never> {
  try { await fn(); } catch (e) { if (e instanceof CouponError) return back({ e: e.message }, hash); throw e; }
  await trail({ area: 'marketing', action: 'coupon', summary: ok });
  return back({ ok }, hash);
}

export async function createCouponAction(fd: FormData) {
  const staff = await requireStaff('manage_coupons');
  let code = '';
  try {
    const c = await createCoupon({
      code: str(fd, 'code'), description: str(fd, 'description'), kind: str(fd, 'kind'), percent: str(fd, 'percent'), amount: str(fd, 'amount'), cap: str(fd, 'cap'),
      minSpend: str(fd, 'min_spend'), startsOn: str(fd, 'starts_on'), endsOn: str(fd, 'ends_on'), maxRedemptions: str(fd, 'max_redemptions'), perCustomer: str(fd, 'per_customer'),
      firstOrderOnly: fd.get('first_order_only') === 'on', productIds: fd.getAll('product').map(String),
    }, staff.id);
    code = c.code;
  } catch (e) {
    if (e instanceof CouponError) return back({ e: e.message }, '#new');
    throw e;
  }
  await trail({ area: 'marketing', action: 'coupon_created', target: code, summary: `Created coupon ${code}` });
  back({ ok: `Coupon ${code} is live. Share the link next to it, or give customers the code.` }, '#list');
}

export async function toggleCouponAction(fd: FormData) {
  await requireStaff('manage_coupons');
  const on = fd.get('on') === '1';
  await run(on ? 'Coupon is active again.' : 'Coupon paused. Customers cannot use it until you turn it back on.', '#list', () => setCouponActive(str(fd, 'id'), on));
}

export async function updateCouponAction(fd: FormData) {
  await requireStaff('manage_coupons');
  await run('Coupon updated.', '#list', () => updateCouponLimits(str(fd, 'id'), { description: str(fd, 'description'), endsOn: str(fd, 'ends_on'), maxRedemptions: str(fd, 'max_redemptions') }));
}

export async function deleteCouponAction(fd: FormData) {
  await requireStaff('manage_coupons');
  await run('Coupon deleted.', '#list', () => deleteCoupon(str(fd, 'id')));
}
