'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { getSettings, setSetting } from '@/lib/settings';
import { syncReferralCoupons } from '@/lib/referrals';
import { trail, trailProduct } from '@/lib/trail';

const back = (msg: { e?: string; ok?: string }, hash = '') => {
  revalidatePath('/console/growth');
  revalidatePath('/', 'layout');
  redirect(`/console/growth?${msg.e ? `e=${encodeURIComponent(msg.e)}` : `ok=${encodeURIComponent(msg.ok ?? 'Saved.')}`}${hash}`);
};
const num = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(/[^\d.]/g, ''));
const kobo = (v: FormDataEntryValue | null) => Math.round(num(v) * 100);

export async function saveNudgeAction(fd: FormData) {
  await requireStaff('manage_growth');
  const mins = Math.trunc(num(fd.get('nudge_after_minutes')));
  if (!(mins >= 30 && mins <= 1440)) return back({ e: 'Wait between 30 minutes and 24 hours (1440 minutes) before the reminder.' }, '#nudge');
  await setSetting('nudge_enabled', fd.get('nudge_enabled') === 'on');
  await setSetting('nudge_after_minutes', mins);
  await trail({ area: 'marketing', action: 'nudge', summary: `Saved the unpaid-order reminder (${fd.get('nudge_enabled') === 'on' ? `after ${mins} minutes` : 'off'})` });
  back({ ok: 'Reminder settings saved.' }, '#nudge');
}

export async function saveRemindersAction(fd: FormData) {
  await requireStaff('manage_growth');
  const days = Math.trunc(num(fd.get('reminder_days')));
  const credit = Math.trunc(num(fd.get('sample_credit_days')));
  if (!(days >= 14 && days <= 365)) return back({ e: 'Remind people to order again after 14 to 365 days.' }, '#reminders');
  if (!(credit >= 7 && credit <= 365)) return back({ e: 'A sample-pack credit must stay valid for 7 to 365 days.' }, '#reminders');
  await setSetting('reminders_enabled', fd.get('reminders_enabled') === 'on');
  await setSetting('reminder_days', days);
  await setSetting('sample_credit_days', credit);
  await trail({ area: 'marketing', action: 'reminders', summary: `Saved repeat reminders (${fd.get('reminders_enabled') === 'on' ? `after ${days} days` : 'off'}) and the sample-pack credit (${credit} days)` });
  back({ ok: 'Saved.' }, '#reminders');
}

export async function saveReferralAction(fd: FormData) {
  await requireStaff('manage_growth');
  const percent = Math.trunc(num(fd.get('referral_friend_percent')));
  const cap = kobo(fd.get('referral_friend_cap'));
  const reward = kobo(fd.get('referral_reward'));
  const days = Math.trunc(num(fd.get('referral_reward_days')));
  const max = Math.trunc(num(fd.get('referral_max_rewards')));
  if (!(percent >= 1 && percent <= 50)) return back({ e: 'A friend\'s discount must be between 1% and 50%.' }, '#referral');
  if (!(cap >= 0 && cap <= 5_000_000)) return back({ e: 'The most a friend can save must be between ₦0 and ₦50,000. Use 0 for no limit.' }, '#referral');
  if (!(reward >= 0 && reward <= 5_000_000)) return back({ e: 'The reward must be between ₦0 and ₦50,000.' }, '#referral');
  if (!(days >= 7 && days <= 365)) return back({ e: 'A reward code must stay valid for 7 to 365 days.' }, '#referral');
  if (!(max >= 0 && max <= 500)) return back({ e: 'The most rewards one person can earn must be between 0 and 500.' }, '#referral');
  await setSetting('referral_enabled', fd.get('referral_enabled') === 'on');
  await setSetting('referral_friend_percent', percent);
  await setSetting('referral_friend_cap_kobo', cap);
  await setSetting('referral_reward_kobo', reward);
  await setSetting('referral_reward_days', days);
  await setSetting('referral_max_rewards', max);
  // Every personal code follows the new numbers, so nobody holds an old offer by mistake.
  const s = await getSettings();
  await syncReferralCoupons({ referral_friend_percent: s.referral_friend_percent, referral_friend_cap_kobo: s.referral_friend_cap_kobo });
  await trail({ area: 'marketing', action: 'referral', summary: `Saved referral settings (${percent}% for a friend, reward ₦${reward / 100})` });
  back({ ok: 'Referral settings saved. Every personal code now uses the new numbers.' }, '#referral');
}

export async function saveSwitchesAction(fd: FormData) {
  await requireStaff('manage_growth');
  await setSetting('windows_enabled', fd.get('windows_enabled') === 'on');
  await setSetting('pidgin_enabled', fd.get('pidgin_enabled') === 'on');
  await trail({ area: 'settings', action: 'switches', summary: `Saved site switches (morning/afternoon delivery ${fd.get('windows_enabled') === 'on' ? 'on' : 'off'}, Pidgin ${fd.get('pidgin_enabled') === 'on' ? 'on' : 'off'})` });
  back({ ok: 'Saved.' }, '#switches');
}
