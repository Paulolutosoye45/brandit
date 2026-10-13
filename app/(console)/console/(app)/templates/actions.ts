'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import * as T from '@/lib/templates';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');

function input(fd: FormData): T.TemplateInput {
  return {
    title: str(fd, 'title'), slug: str(fd, 'slug'), category: str(fd, 'category'), blurb: str(fd, 'blurb'), includes: str(fd, 'includes'),
    productId: str(fd, 'productId'), quantity: str(fd, 'quantity'), sizeKey: str(fd, 'sizeKey'), widthFt: str(fd, 'widthFt'), heightFt: str(fd, 'heightFt'),
    purpose: str(fd, 'purpose'), fields: str(fd, 'fields'), layout: str(fd, 'layout'), palette: str(fd, 'palette'), lines: str(fd, 'lines'),
  };
}

function refresh(id?: string) {
  revalidatePath('/console/templates');
  if (id) revalidatePath(`/console/templates/${id}`);
  revalidatePath('/templates');
  revalidatePath('/');
}

export async function createTemplateAction(fd: FormData) {
  await requireStaff('manage_templates');
  let id: string;
  try {
    id = (await T.createTemplate(input(fd))).id;
  } catch (e) {
    if (e instanceof T.TemplateError) redirect(`/console/templates/new?e=${encodeURIComponent(e.message)}`);
    throw e;
  }
  refresh();
  redirect(`/console/templates/${id}?ok=${encodeURIComponent('Template created. It is hidden until you add a preview and switch it on.')}`);
}

export async function saveTemplateAction(fd: FormData) {
  await requireStaff('manage_templates');
  const id = str(fd, 'id');
  try {
    await T.updateTemplate(id, input(fd));
  } catch (e) {
    if (e instanceof T.TemplateError) redirect(`/console/templates/${id}?e=${encodeURIComponent(e.message)}`);
    throw e;
  }
  refresh(id);
  redirect(`/console/templates/${id}?ok=${encodeURIComponent('Saved. Customers see the change straight away.')}`);
}

export async function setTemplateActiveAction(fd: FormData) {
  await requireStaff('manage_templates');
  const id = str(fd, 'id');
  const on = fd.get('on') === '1';
  await T.setTemplateActive(id, on);
  refresh(id);
  redirect(`${str(fd, 'back') === 'edit' ? `/console/templates/${id}` : '/console/templates'}?ok=${encodeURIComponent(on ? 'Template is live. Customers can use it now.' : 'Template is hidden.')}`);
}

export async function moveTemplateAction(fd: FormData) {
  await requireStaff('manage_templates');
  await T.moveTemplate(str(fd, 'id'), str(fd, 'dir') === 'up' ? 'up' : 'down');
  refresh();
  redirect('/console/templates');
}

export async function clearTemplateImageAction(fd: FormData) {
  await requireStaff('manage_templates');
  const id = str(fd, 'id');
  await T.clearTemplateImage(id);
  refresh(id);
  redirect(`/console/templates/${id}?ok=${encodeURIComponent('Picture removed. The drawn preview is shown again.')}#picture`);
}

export async function deleteTemplateAction(fd: FormData) {
  await requireStaff('manage_templates');
  const id = str(fd, 'id');
  if (str(fd, 'confirm').trim().toLowerCase() !== 'delete') redirect(`/console/templates/${id}?e=${encodeURIComponent('Type the word delete to confirm.')}`);
  await T.deleteTemplate(id);
  refresh();
  redirect(`/console/templates?ok=${encodeURIComponent('Template deleted. Orders already started from it are not affected.')}`);
}
