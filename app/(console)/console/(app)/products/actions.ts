'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import * as P from '@/lib/productAdmin';
import * as PA from '@/lib/priceAdmin';
import * as OA from '@/lib/optionsAdmin';
import { deleteProductImage, makeCover, setAlt } from '@/lib/productImages';
import { loadExamples, clearExamples, examplesAllowed } from '@/lib/catalogueInstall';
import { query, tx, one } from '@/lib/db';
import type { PricingMode } from '@/lib/types';
import { trail, trailProduct } from '@/lib/trail';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');

/** Every action ends the same way: back to the page with a sentence, good or bad. */
function done(id: string | null, msg: { e?: string; ok?: string }, hash = '', page = ''): never {
  revalidatePath('/console/products');
  if (id) revalidatePath(`/console/products/${id}`, 'layout');
  revalidatePath('/products', 'layout');
  revalidatePath('/');
  const base = id ? `/console/products/${id}${page}` : '/console/products';
  redirect(`${base}?${msg.e ? `e=${encodeURIComponent(msg.e)}` : `ok=${encodeURIComponent(msg.ok ?? 'Saved.')}`}${hash}`);
}

/** Run a change, turn our own error sentences into messages, and let anything else surface as a real error. */
async function run(id: string | null, ok: string | ((r: any) => string), hash: string, fn: () => Promise<unknown>, page = ''): Promise<never> {
  let result: unknown;
  try {
    result = await fn();
  } catch (e) {
    if (e instanceof P.ProductError) return done(id, { e: e.message }, hash, page);
    throw e;
  }
  return done(id, { ok: typeof ok === 'function' ? ok(result) : ok }, hash, page);
}

const actorOf = (s: { id: string; name: string }): PA.Actor => ({ id: s.id, name: s.name });

function json(fd: FormData): unknown {
  try {
    return JSON.parse(str(fd, 'json'));
  } catch {
    throw new P.ProductError('That did not save. Reload the page and try again.');
  }
}

export async function createProductAction(fd: FormData) {
  await requireStaff('manage_catalog');
  let made: { id: string } | null = null;
  try {
    made = await P.createProduct({ name: str(fd, 'name'), category: str(fd, 'category'), blurb: str(fd, 'blurb'), mode: str(fd, 'mode') as PricingMode });
  } catch (e) {
    if (e instanceof P.ProductError) redirect(`/console/products/new?e=${encodeURIComponent(e.message)}`);
    throw e;
  }
  await trailProduct(made.id, { action: 'product_created', summary: 'Created a product' });
  revalidatePath('/console/products');
  redirect(`/console/products/${made.id}?ok=${encodeURIComponent('Product created. It is hidden until you add a price and switch it on.')}`);
}

export async function saveDetailsAction(fd: FormData) {
  await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  await run(id, 'Details saved.', '#details', async () => {
    const r = await P.saveDetails(id, {
      name: str(fd, 'name'), category: str(fd, 'category'), blurb: str(fd, 'blurb'), description: str(fd, 'description'), highlights: str(fd, 'highlights'),
      allow_custom: fd.get('allow_custom') === 'on', personalise: fd.get('personalise') === 'on', check_class: str(fd, 'check_class'), print_w_in: str(fd, 'print_w_in'), print_h_in: str(fd, 'print_h_in'),
    });
    await trailProduct(id, { action: 'product_details', summary: 'Saved product details' });
    return r;
  });
}

export async function saveOptionsAction(fd: FormData) {
  const staff = await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  await run(id, (r: OA.OptionsSaveReport) => `Options saved. Customers see them straight away.${r.stray ? ` ${r.stray} price${r.stray === 1 ? ' no longer matches' : 's no longer match'} a choice: see "Stray prices" in the price grid.` : ''}`, '#options', () => OA.saveOptionsV2(id, json(fd), actorOf(staff)), '/options');
}

export async function savePackagesAction(fd: FormData) {
  const staff = await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  await run(id, 'Packages saved. Customers see them straight away.', '#packages', () => OA.savePackages(id, json(fd), actorOf(staff)), '/options');
}

export async function saveQuantityAction(fd: FormData) {
  const staff = await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  await run(id, 'Quantity rule saved.', '#quantity', () => OA.saveQuantityRule(id, { custom: fd.get('custom') === 'on', min: str(fd, 'min'), max: str(fd, 'max') }, actorOf(staff)), '/options');
}

export async function saveSizesAction(fd: FormData) {
  const staff = await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  await run(id, (r: { removedPrices: number }) => `Sizes saved.${r.removedPrices ? ` ${r.removedPrices} price${r.removedPrices === 1 ? '' : 's'} went with the sizes you took away.` : ' Set the price of any new size in the price grid.'}`, '#sizes', () => OA.saveSizesOnly(id, json(fd), actorOf(staff)), '/options');
}

// ---------- The price grid ----------
export async function saveGridAction(fd: FormData) {
  const staff = await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  await run(
    id,
    (r: PA.SaveReport) => `${r.summary} Customers see the new prices straight away; orders already placed keep their price.${r.belowCost.length ? ` Careful: ${r.belowCost.length} price${r.belowCost.length === 1 ? ' is' : 's are'} below cost (${r.belowCost.slice(0, 3).join('; ')}${r.belowCost.length > 3 ? '…' : ''}).` : ''}`,
    '',
    () => PA.saveGrid(id, json(fd) as PA.SaveGridIn, actorOf(staff)),
    '/prices',
  );
}

export async function confirmPlaceholdersAction(fd: FormData) {
  const staff = await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  await run(id, (n: number) => (n ? `${n} placeholder price${n === 1 ? '' : 's'} confirmed as real.` : 'There were no placeholder prices.'), '', () => PA.confirmPlaceholders(id, actorOf(staff)), '/prices');
}

export async function removeStrayAction(fd: FormData) {
  const staff = await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  await run(id, (n: number) => `${n} stray price${n === 1 ? '' : 's'} removed.`, '', () => PA.removeStray(id, fd.getAll('stray').map(String), actorOf(staff)), '/prices');
}

/** Called from the price grid's "Try a price" panel. Reads only. */
export async function tryPriceAction(productId: string, input: PA.TryIn) {
  await requireStaff('manage_catalog');
  if (!/^[0-9a-f-]{36}$/.test(productId)) return { ok: false as const, error: 'We could not find that product.', availability: null };
  return PA.tryPrice(productId, input);
}

// ---------- Example prices (the demo and the private test site) ----------
export async function loadExamplesAction() {
  await requireStaff('manage_catalog');
  if (!examplesAllowed()) return done(null, { e: 'Example prices can only be loaded on the demo or the private test site.' });
  const r = await loadExamples({ query, tx });
  done(null, { ok: `Example prices filled in: ${r.cells} table prices and ${r.choices} add-on prices. Every one is marked as a placeholder.` });
}
export async function clearExamplesAction() {
  await requireStaff('manage_catalog');
  if (!examplesAllowed()) return done(null, { e: 'Example prices can only be cleared on the demo or the private test site.' });
  const r = await clearExamples({ query, tx });
  done(null, { ok: `Example prices removed: ${r.cells} table prices and ${r.choices} add-on prices. Only real prices remain.` });
}

export async function save24hAction(fd: FormData) {
  await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  await run(id, 'Delivery limits saved.', '#delivery', () =>
    P.save24h(id, { eligible: fd.get('eligible') === 'on', max_quantity: str(fd, 'max_quantity'), max_area: str(fd, 'max_area'), max_size_rank: str(fd, 'max_size_rank'), standard_days: str(fd, 'standard_days') }),
  );
}

export async function setActiveAction(fd: FormData) {
  await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  const on = fd.get('on') === '1';
  await run(id, on ? 'This product is on sale. Customers can see it now.' : 'This product is hidden. Customers cannot see it.', '', async () => {
    const r = await P.setActive(id, on);
    await trailProduct(id, { action: on ? 'product_on' : 'product_off', summary: on ? 'Put a product on sale' : 'Hid a product' });
    return r;
  });
}

export async function moveProductAction(fd: FormData) {
  await requireStaff('manage_catalog');
  await P.moveProduct(str(fd, 'id'), str(fd, 'dir') === 'up' ? 'up' : 'down');
  revalidatePath('/console/products');
  revalidatePath('/products');
  revalidatePath('/');
  redirect('/console/products');
}

export async function deleteProductAction(fd: FormData) {
  await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  if (str(fd, 'confirm').trim().toLowerCase() !== 'delete') return done(id, { e: 'Type the word delete to confirm.' });
  const name = (await one<{ name: string }>('select name from products where id = $1', [id]).catch(() => null))?.name;
  try {
    await P.deleteProduct(id);
    await trail({ area: 'catalogue', action: 'product_deleted', target: name ?? id, summary: `Deleted the product ${name ?? id}` });
  } catch (e) {
    if (e instanceof P.ProductError) return done(id, { e: e.message });
    throw e;
  }
  revalidatePath('/console/products');
  revalidatePath('/products');
  redirect(`/console/products?ok=${encodeURIComponent('Product deleted.')}`);
}

// ---------- Photos ----------
export async function deleteImageAction(fd: FormData) {
  await requireStaff('manage_catalog');
  const pid = await deleteProductImage(str(fd, 'image'));
  done(pid ?? str(fd, 'id'), { ok: 'Photo removed.' }, '#photos');
}
export async function coverImageAction(fd: FormData) {
  await requireStaff('manage_catalog');
  await makeCover(str(fd, 'image'));
  done(str(fd, 'id'), { ok: 'That photo is now the main one.' }, '#photos');
}
export async function altImageAction(fd: FormData) {
  await requireStaff('manage_catalog');
  await setAlt(str(fd, 'image'), str(fd, 'alt'));
  done(str(fd, 'id'), { ok: 'Photo description saved.' }, '#photos');
}
