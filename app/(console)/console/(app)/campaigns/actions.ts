'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import * as C from '@/lib/campaigns';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');

function input(fd: FormData): C.CampaignInput {
  return {
    title: str(fd, 'title'), slug: str(fd, 'slug'), headline: str(fd, 'headline'), intro: str(fd, 'intro'), theme: str(fd, 'theme'),
    startsOn: str(fd, 'startsOn'), endsOn: str(fd, 'endsOn'), note: str(fd, 'note'), couponCode: str(fd, 'couponCode'),
    productSlugs: fd.getAll('products').map(String), templateSlugs: fd.getAll('templates').map(String), showOnHome: fd.get('showOnHome') === 'on',
  };
}
function refresh(slug?: string) {
  revalidatePath('/console/campaigns');
  revalidatePath('/');
  revalidatePath('/sitemap.xml');
  if (slug) revalidatePath(`/season/${slug}`);
}

export async function createCampaignAction(fd: FormData) {
  await requireStaff('manage_campaigns');
  let c: C.Campaign;
  try { c = await C.createCampaign(input(fd)); } catch (e) {
    if (e instanceof C.CampaignError) redirect(`/console/campaigns/new?e=${encodeURIComponent(e.message)}`);
    throw e;
  }
  refresh();
  redirect(`/console/campaigns/${c.id}?ok=${encodeURIComponent('Page created. It is hidden until you switch it on.')}`);
}
export async function saveCampaignAction(fd: FormData) {
  await requireStaff('manage_campaigns');
  const id = str(fd, 'id');
  try { await C.updateCampaign(id, input(fd)); } catch (e) {
    if (e instanceof C.CampaignError) redirect(`/console/campaigns/${id}?e=${encodeURIComponent(e.message)}`);
    throw e;
  }
  refresh(str(fd, 'slug'));
  redirect(`/console/campaigns/${id}?ok=${encodeURIComponent('Saved.')}`);
}
export async function setCampaignActiveAction(fd: FormData) {
  await requireStaff('manage_campaigns');
  const id = str(fd, 'id');
  const on = fd.get('on') === '1';
  await C.setCampaignActive(id, on);
  refresh();
  redirect(`${str(fd, 'back') === 'edit' ? `/console/campaigns/${id}` : '/console/campaigns'}?ok=${encodeURIComponent(on ? 'Switched on. It shows to customers on its dates.' : 'Switched off. Customers cannot see it.')}`);
}
export async function moveCampaignAction(fd: FormData) {
  await requireStaff('manage_campaigns');
  await C.moveCampaign(str(fd, 'id'), str(fd, 'dir') === 'up' ? 'up' : 'down');
  refresh();
  redirect('/console/campaigns');
}
export async function deleteCampaignAction(fd: FormData) {
  await requireStaff('manage_campaigns');
  const id = str(fd, 'id');
  if (str(fd, 'confirm').trim().toLowerCase() !== 'delete') redirect(`/console/campaigns/${id}?e=${encodeURIComponent('Type the word delete to confirm.')}`);
  await C.deleteCampaign(id);
  refresh();
  redirect(`/console/campaigns?ok=${encodeURIComponent('Page deleted.')}`);
}
