'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { requireStaff, type StaffUser } from '@/lib/session';
import { assignPress, completeWithCode, flagFile, moveJob, saveDelivery, sendProof } from '@/lib/jobs';
import { saveSimpleFile } from '@/lib/artwork';
import type { Stage } from '@/lib/types';

/** Run one job action. Errors are shown in plain words on the job page; redirects happen outside the try. */
async function run(fd: FormData, fn: (staff: StaffUser, ctx: { jobId: string; orderId: string; itemId: string }) => Promise<string | void>) {
  const jobId = String(fd.get('jobId'));
  const staff = await requireStaff();
  const j = await one<any>('select id, order_id, order_item_id from jobs where id = $1', [jobId]);
  if (!j) redirect('/console/queue');
  let msg = 'Done.';
  let err: string | null = null;
  try {
    const r = await fn(staff, { jobId, orderId: j.order_id, itemId: j.order_item_id });
    if (typeof r === 'string') msg = r;
  } catch (e) {
    err = (e as Error).message || 'Something went wrong.';
  }
  revalidatePath(`/console/jobs/${jobId}`);
  revalidatePath('/console/queue');
  redirect(`/console/jobs/${jobId}?${err ? `e=${encodeURIComponent(err)}` : `ok=${encodeURIComponent(msg)}`}`);
}

const note = (fd: FormData) => String(fd.get('note') ?? '').trim();
const go = (to: Stage, ok: string) => (fd: FormData) => run(fd, async (staff, c) => { await moveJob(c.jobId, to, { actor: staff, note: note(fd) || undefined }); return ok; });

export const passFile = go('printing', 'File passed. It is now printing.');
export const toQuality = go('quality_check', 'Moved to the quality check.');
export const toDelivery = go('out_for_delivery', 'Out for delivery. The customer has their photo and code.');
export const approveByNote = go('printing', 'Proof approved on the customer\'s behalf. It is now printing.');
export const failQuality = go('printing', 'Sent back to printing for a reprint.');
export const markDelivered = go('delivered', 'Marked delivered.');

export async function flag(fd: FormData) {
  return run(fd, async (staff, c) => { await flagFile(c.jobId, staff, note(fd)); return 'Flagged. The customer has been told and the clock is paused.'; });
}

export async function uploadProof(fd: FormData) {
  return run(fd, async (staff, c) => {
    const f = fd.get('file');
    if (!(f instanceof File) || f.size === 0) throw new Error('Choose the proof file first.');
    const r = await saveSimpleFile(c.orderId, c.itemId, 'proof', { name: f.name, type: f.type, buf: Buffer.from(await f.arrayBuffer()) });
    if (!r.ok) throw new Error(r.error);
    await sendProof(c.jobId, staff, r.fileId);
    return 'Proof sent. The customer has the link.';
  });
}

export async function uploadQcPhoto(fd: FormData) {
  return run(fd, async (staff, c) => {
    if (staff.role !== 'admin' && staff.role !== 'production_lead') throw new Error('Only the production lead can add the finished-job photo.');
    const f = fd.get('file');
    if (!(f instanceof File) || f.size === 0) throw new Error('Choose the photo first.');
    const r = await saveSimpleFile(c.orderId, c.itemId, 'qc_photo', { name: f.name, type: f.type, buf: Buffer.from(await f.arrayBuffer()) });
    if (!r.ok) throw new Error(r.error);
    return 'Photo added. It goes to the customer when you send the job out.';
  });
}

export async function saveRider(fd: FormData) {
  return run(fd, async (staff, c) => {
    await saveDelivery(c.orderId, staff, { rider_name: String(fd.get('rider_name') ?? ''), rider_phone: String(fd.get('rider_phone') ?? ''), tracking_url: String(fd.get('tracking_url') ?? ''), provider: String(fd.get('provider') ?? '') });
    return 'Rider details saved.';
  });
}

export async function deliverWithCode(fd: FormData) {
  return run(fd, async (_staff, c) => {
    await completeWithCode(c.jobId, String(fd.get('code') ?? ''));
    return 'Delivered. The customer has been told.';
  });
}

export async function setPress(fd: FormData) {
  return run(fd, async (staff, c) => {
    await assignPress(c.jobId, staff, String(fd.get('press_id')));
    return 'Press assigned.';
  });
}
