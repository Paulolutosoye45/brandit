'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/session';
import { setSetting } from '@/lib/settings';
import { runSweep } from '@/lib/sweep';
import { trail, trailProduct } from '@/lib/trail';

export async function togglePause(fd: FormData) {
  await requireStaff('edit_rules');
  await setSetting('slots_paused', fd.get('pause') === '1');
  await trail({ area: 'settings', action: 'slots_pause', summary: fd.get('pause') === '1' ? 'Paused 24-hour slots' : 'Resumed 24-hour slots' });
  revalidatePath('/console/queue');
}
export async function runChecks() {
  await requireStaff('run_checks');
  await runSweep();
  revalidatePath('/console/queue');
}
