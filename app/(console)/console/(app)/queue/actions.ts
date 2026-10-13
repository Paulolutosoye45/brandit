'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/session';
import { setSetting } from '@/lib/settings';
import { runSweep } from '@/lib/sweep';

export async function togglePause(fd: FormData) {
  await requireStaff('edit_rules');
  await setSetting('slots_paused', fd.get('pause') === '1');
  revalidatePath('/console/queue');
}
export async function runChecks() {
  await requireStaff('run_checks');
  await runSweep();
  revalidatePath('/console/queue');
}
