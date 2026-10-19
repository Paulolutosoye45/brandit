import { audit, type AuditArea } from './audit';
import { getStaff } from './session';
import { one } from './db';

/** For console actions: write "who did what" to the activity log, taking the person from the sign-in. Never throws. */
export async function trail(a: { area: AuditArea; action: string; target?: string; summary: string; detail?: Record<string, unknown> }): Promise<void> {
  try {
    const s = await getStaff();
    await audit({ id: s?.id ?? null, name: s?.name ?? 'Unknown' }, a);
  } catch { /* the activity log must never break the change it describes */ }
}

/** Same, naming the product from its id. */
export async function trailProduct(productId: string, a: { action: string; summary: string }): Promise<void> {
  const p = await one<{ name: string }>('select name from products where id = $1', [productId]).catch(() => null);
  await trail({ area: 'catalogue', action: a.action, target: p?.name ?? productId, summary: `${a.summary}${p ? ` (${p.name})` : ''}`, detail: { productId } });
}
