'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { query } from '@/lib/db';
import { requireStaff } from '@/lib/session';
import { setSetting } from '@/lib/settings';
import { trail, trailProduct } from '@/lib/trail';

const back = (msg: { e?: string; ok?: string }, hash = '') => {
  revalidatePath('/console/rules');
  redirect(`/console/rules?${msg.e ? `e=${encodeURIComponent(msg.e)}` : `ok=${encodeURIComponent(msg.ok ?? 'Saved.')}`}${hash}`);
};
const kobo = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? '').replace(/[^\d.]/g, '')) * 100);
const num = (v: FormDataEntryValue | null) => Number(String(v ?? '').trim());
const time = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveSettingsAction(fd: FormData) {
  await requireStaff('edit_rules');
  const cutoff = String(fd.get('cutoff_time') ?? '');
  const arrive = String(fd.get('arrive_by') ?? '');
  if (!time.test(cutoff) || !time.test(arrive)) return back({ e: 'Times must look like 12:00 or 17:00.' });
  const slots = num(fd.get('daily_24h_slots'));
  if (!Number.isInteger(slots) || slots < 0 || slots > 500) return back({ e: 'Daily 24-hour slots must be a whole number from 0 to 500.' });
  const holidays = String(fd.get('holidays') ?? '').split(/[\s,]+/).filter(Boolean);
  if (holidays.some((h) => !/^\d{4}-\d{2}-\d{2}$/.test(h))) return back({ e: 'Holidays must be dates like 2026-12-25, one per line.' });
  const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => fd.get(`wd_${d}`) === 'on');
  if (days.length === 0) return back({ e: 'Choose at least one working day.' });
  const vat = num(fd.get('vat_rate'));
  if (!(vat >= 0 && vat <= 30)) return back({ e: 'VAT must be between 0 and 30 percent.' });

  await setSetting('cutoff_time', cutoff);
  await setSetting('arrive_by', arrive);
  await setSetting('daily_24h_slots', slots);
  await setSetting('slots_paused', fd.get('slots_paused') === 'on');
  await setSetting('working_days', days);
  await setSetting('holidays', holidays);
  await setSetting('vat_rate', vat / 100);
  await setSetting('prices_include_vat', fd.get('prices_include_vat') === 'on');
  await setSetting('hold_minutes', Math.max(1, Math.trunc(num(fd.get('hold_minutes')) || 15)));
  await setSetting('design_fee_kobo', kobo(fd.get('design_fee')));
  await setSetting('fix_fee_kobo', kobo(fd.get('fix_fee')));
  await setSetting('lead_reprint_limit_kobo', kobo(fd.get('lead_limit')));
  await setSetting('claim_window_hours', Math.max(1, Math.trunc(num(fd.get('claim_window')) || 48)));
  await setSetting('at_risk_qc_hours', Math.max(0, num(fd.get('risk_qc')) || 4));
  await setSetting('at_risk_dispatch_hours', Math.max(0, num(fd.get('risk_dispatch')) || 2));
  const replyHours = Math.trunc(num(fd.get('custom_reply_hours')) || 24);
  const validDays = Math.trunc(num(fd.get('custom_quote_valid_days')) || 7);
  if (!(replyHours >= 1 && replyHours <= 168)) return back({ e: 'Custom-order reply time must be between 1 and 168 hours.' });
  if (!(validDays >= 1 && validDays <= 60)) return back({ e: 'A custom quote must stay valid for 1 to 60 days.' });
  await setSetting('custom_reply_hours', replyHours);
  await setSetting('custom_quote_valid_days', validDays);
  await setSetting('pickup_address', String(fd.get('pickup_address') ?? '').replace(/\s+/g, ' ').trim().slice(0, 200));
  await trail({ area: 'settings', action: 'delivery_rules', target: 'Delivery & rules', summary: `Saved turnaround and rules (cut-off ${cutoff}, arrive by ${arrive}, ${slots} 24-hour slots a day)` });
  back({ ok: 'Settings saved. They apply to new quotes straight away.' }, '#settings');
}

export async function saveZoneAction(fd: FormData) {
  await requireStaff('edit_rules');
  const id = String(fd.get('id'));
  const areas = String(fd.get('areas') ?? '').split(/[\n,]+/).map((a) => a.trim()).filter(Boolean);
  const fee = kobo(fd.get('fee'));
  if (areas.length === 0) return back({ e: 'A zone needs at least one area.' }, '#zones');
  await query('update delivery_zones set fee_kobo = $2, eligible_24h = $3, areas = $4, name = $5, provisional = false where id = $1', [id, fee, fd.get('eligible') === 'on', areas, String(fd.get('name') ?? '').trim() || 'Zone']);
  await trail({ area: 'settings', action: 'zone', target: String(fd.get('name') ?? ''), summary: `Saved delivery zone “${String(fd.get('name') ?? '').trim()}” (fee ₦${(fee / 100).toLocaleString('en-NG')}, ${areas.length} areas)` });
  back({ ok: 'Zone saved.' }, '#zones');
}
