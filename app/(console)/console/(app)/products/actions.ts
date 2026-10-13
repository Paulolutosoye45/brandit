'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import * as P from '@/lib/productAdmin';
import { deleteProductImage, makeCover, setAlt } from '@/lib/productImages';
import type { PricingMode } from '@/lib/types';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');

/** Every action ends the same way: back to the page with a sentence, good or bad. */
function done(id: string | null, msg: { e?: string; ok?: string }, hash = ''): never {
  revalidatePath('/console/products');
  if (id) revalidatePath(`/console/products/${id}`);
  revalidatePath('/products');
  revalidatePath('/');
  const base = id ? `/console/products/${id}` : '/console/products';
  redirect(`${base}?${msg.e ? `e=${encodeURIComponent(msg.e)}` : `ok=${encodeURIComponent(msg.ok ?? 'Saved.')}`}${hash}`);
}

/** Run a change, turn our own error sentences into messages, and let anything else surface as a real error. */
async function run(id: string | null, ok: string, hash: string, fn: () => Promise<unknown>): Promise<never> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof P.ProductError) return done(id, { e: e.message }, hash);
    throw e;
  }
  return done(id, { ok }, hash);
}

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
  revalidatePath('/console/products');
  redirect(`/console/products/${made.id}?ok=${encodeURIComponent('Product created. It is hidden until you add a price and switch it on.')}`);
}

export async function saveDetailsAction(fd: FormData) {
  await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  await run(id, 'Details saved.', '#details', () =>
    P.saveDetails(id, {
      name: str(fd, 'name'), category: str(fd, 'category'), blurb: str(fd, 'blurb'), description: str(fd, 'description'), highlights: str(fd, 'highlights'),
      allow_custom: fd.get('allow_custom') === 'on', check_class: str(fd, 'check_class'), print_w_in: str(fd, 'print_w_in'), print_h_in: str(fd, 'print_h_in'),
    }),
  );
}

export async function saveOptionsAction(fd: FormData) {
  await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  await run(id, 'Options saved.', '#options', async () => P.saveOptions(id, json(fd)));
}

export async function saveSizesAction(fd: FormData) {
  await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  await run(id, 'Sizes and prices saved. Customers see them straight away.', '#prices', async () => P.saveSizes(id, json(fd)));
}

export async function saveTiersAction(fd: FormData) {
  await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  await run(id, 'Prices saved. Customers see them straight away.', '#prices', async () => P.saveTierPrices(id, json(fd)));
}

export async function saveAreaAction(fd: FormData) {
  await requireStaff('manage_catalog');
  const id = str(fd, 'id');
  await run(id, 'Price saved. Customers see it straight away.', '#prices', () => P.saveAreaPrice(id, fd.get('rate'), fd.get('min_area')));
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
  await run(id, on ? 'This product is on sale. Customers can see it now.' : 'This product is hidden. Customers cannot see it.', '', () => P.setActive(id, on));
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
  try {
    await P.deleteProduct(id);
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
