'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCustomer } from '@/lib/session';
import { deleteAsset, KitError, saveBrandKit, saveOrderDesign } from '@/lib/brandKit';

async function me() {
  const c = await getCustomer();
  if (!c) redirect('/signin?next=/account/brand');
  return c;
}
const back = (kind: 'e' | 'ok', msg: string, hash = ''): never => redirect(`/account/brand?${kind}=${encodeURIComponent(msg)}${hash}`);

export async function saveKitAction(fd: FormData) {
  const c = await me();
  try {
    await saveBrandKit(c.id, Object.fromEntries(fd.entries()));
  } catch (e) {
    if (e instanceof KitError) back('e', e.message);
    throw e;
  }
  revalidatePath('/account/brand');
  back('ok', 'Your brand details are saved. We use them whenever you ask us to design something.');
}

export async function deleteAssetAction(fd: FormData) {
  const c = await me();
  await deleteAsset(c.id, String(fd.get('id') ?? ''));
  revalidatePath('/account/brand');
  back('ok', 'File removed from your brand kit.', '#files');
}

export async function saveDesignAction(fd: FormData) {
  const c = await me();
  try {
    await saveOrderDesign(c.id, String(fd.get('token') ?? ''));
  } catch (e) {
    if (e instanceof KitError) back('e', e.message, '#files');
    throw e;
  }
  revalidatePath('/account/brand');
  back('ok', 'Saved to your brand kit.', '#files');
}
