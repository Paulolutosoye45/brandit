'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { addPress, addStaff, resetPin, setRole, setStaffActive } from '@/lib/team';
import { trail, trailProduct } from '@/lib/trail';

const back = (m: { e?: string; ok?: string }): never => {
  revalidatePath('/console/team');
  redirect(`/console/team?${m.e ? `e=${encodeURIComponent(m.e)}` : `ok=${encodeURIComponent(m.ok ?? 'Saved.')}`}`);
};
const s = (fd: FormData, k: string) => String(fd.get(k) ?? '');

export async function addStaffAction(fd: FormData) {
  await requireStaff('manage_team');
  const r = await addStaff({ name: s(fd, 'name'), email: s(fd, 'email'), role: s(fd, 'role'), pin: s(fd, 'pin'), pressId: s(fd, 'press') || null });
  if (!r.ok) back({ e: r.error });
  await trail({ area: 'team', action: 'add_staff', target: s(fd, 'email'), summary: `Added ${s(fd, 'name').trim()} to the team as ${s(fd, 'role').replace('_', ' ')}` });
  back({ ok: `${s(fd, 'name').trim()} can now sign in at /console/login with their email and PIN.` });
}
export async function toggleActiveAction(fd: FormData) {
  const me = await requireStaff('manage_team');
  const r = await setStaffActive(s(fd, 'id'), s(fd, 'active') === 'true', me.id);
  if (!r.ok) back({ e: r.error });
  await trail({ area: 'team', action: s(fd, 'active') === 'true' ? 'staff_on' : 'staff_off', target: s(fd, 'id'), summary: s(fd, 'active') === 'true' ? 'Switched a team member back on' : 'Switched a team member off' });
  back({ ok: s(fd, 'active') === 'true' ? 'Switched back on.' : 'Switched off. They can no longer sign in.' });
}
export async function changeRoleAction(fd: FormData) {
  await requireStaff('manage_team');
  const r = await setRole(s(fd, 'id'), s(fd, 'role'), s(fd, 'press') || null);
  if (!r.ok) back({ e: r.error });
  await trail({ area: 'team', action: 'role', target: s(fd, 'id'), summary: `Changed a team member’s role to ${s(fd, 'role').replace('_', ' ')}` });
  back({ ok: 'Role changed.' });
}
export async function resetPinAction(fd: FormData) {
  await requireStaff('manage_team');
  const r = await resetPin(s(fd, 'id'), s(fd, 'pin'));
  if (!r.ok) back({ e: r.error });
  await trail({ area: 'security', action: 'pin_set_by_admin', target: s(fd, 'id'), summary: 'Set a new PIN for a team member' });
  back({ ok: 'New PIN saved. Tell them in person or by call, not in a group chat.' });
}
export async function addPressAction(fd: FormData) {
  await requireStaff('manage_team');
  const r = await addPress(s(fd, 'name'), fd.get('partner') === 'on');
  if (!r.ok) back({ e: r.error });
  back({ ok: 'Added.' });
}
