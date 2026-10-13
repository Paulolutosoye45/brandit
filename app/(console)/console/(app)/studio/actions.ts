'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { getSettings, setSetting } from '@/lib/settings';
import { one, query } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import { cleanEmail, isEmail } from '@/lib/otp';
import { parseStudioForm, STUDIO_GROUPS } from '@/lib/studio/settingsSchema';
import { decideReview } from '@/lib/studio/reviews';
import { liftPause } from '@/lib/studio/limits';
import { audit } from '@/lib/studio/projects';
import { generateArt } from '@/lib/studio/engine';
import { ENGINE_IDS, vendorsOn, resolveEngine } from '@/lib/studio/providers/catalog';
import type { EngineId } from '@/lib/studio/providers/types';
import { buildArt, paletteById } from '@/lib/studio/prompts';

const back = (path: string, msg: { e?: string; ok?: string }, hash = '') => {
  revalidatePath('/console/studio');
  redirect(`${path}?${msg.e ? `e=${encodeURIComponent(msg.e)}` : `ok=${encodeURIComponent(msg.ok ?? 'Saved.')}`}${hash}`);
};

/** Save one group of settings from the settings page. */
export async function saveGroupAction(fd: FormData) {
  await requireStaff('manage_studio');
  const gid = String(fd.get('group') ?? '');
  const g = STUDIO_GROUPS.find((x) => x.id === gid);
  if (!g) return back('/console/studio/settings', { e: 'Unknown section.' });
  const parsed = parseStudioForm((n) => (fd.has(n) ? String(fd.get(n)) : null), g.fields.map((f) => f.key as string));
  if (!parsed.ok) return back('/console/studio/settings', { e: parsed.error }, `#${gid}`);
  // A few sanity rules across fields.
  const s = await getSettings();
  const v = { ...s, ...parsed.values };
  if (v.studio_premium_kobo < v.studio_standard_kobo) return back('/console/studio/settings', { e: 'Premium should cost more than Standard.' }, `#${gid}`);
  for (const [k, val] of Object.entries(parsed.values)) await setSetting(k as any, val as any);
  await audit(null, `staff`, 'settings_changed', { group: gid, keys: Object.keys(parsed.values) });
  return back('/console/studio/settings', { ok: `${g.title} saved. It applies straight away.` }, `#${gid}`);
}

/** The two big switches on the overview page. */
export async function saveSwitchesAction(fd: FormData) {
  await requireStaff('manage_studio');
  const keys = ['studio_enabled', 'studio_standard_on', 'studio_premium_on'] as const;
  for (const k of keys) await setSetting(k, fd.get(k) === 'on');
  const acc = String(fd.get('studio_access') ?? '');
  if (acc === 'everyone' || acc === 'invited') await setSetting('studio_access', acc);
  await audit(null, 'staff', 'switches_changed', {});
  return back('/console/studio', { ok: 'Saved.' });
}

export async function addInviteAction(fd: FormData) {
  await requireStaff('manage_studio');
  const lines = String(fd.get('who') ?? '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).slice(0, 200);
  const note = String(fd.get('note') ?? '').slice(0, 80);
  let added = 0;
  const bad: string[] = [];
  for (const l of lines) {
    const id = isEmail(cleanEmail(l)) ? cleanEmail(l) : normalizePhone(l);
    if (!id) { bad.push(l); continue; }
    await query('insert into studio_invites (identifier, note) values ($1,$2) on conflict (identifier) do nothing', [id, note || null]);
    added++;
  }
  return back('/console/studio/settings', bad.length ? { e: `Added ${added}. These were not a phone number or email: ${bad.slice(0, 5).join(', ')}` } : { ok: `Added ${added}.` }, '#invites');
}
export async function removeInviteAction(fd: FormData) {
  await requireStaff('manage_studio');
  await query('delete from studio_invites where identifier = $1', [String(fd.get('id') ?? '')]);
  return back('/console/studio/settings', { ok: 'Removed.' }, '#invites');
}

/** One real picture from each connected company, to prove the keys work. It costs a few cents and appears in the spend table. */
export async function testEnginesAction() {
  await requireStaff('manage_studio');
  const s = await getSettings();
  const on = vendorsOn() as Record<string, boolean>;
  const results: string[] = [];
  const art = buildArt({
    brief: { occasion: 'party', lines: {}, look: 'calm blue and gold pattern, simple', style: 'modern-minimal', palette: 'royal-gold', choices: { font: 'montserrat', theme: 'auto', style: 'panels', photoShape: 'rounded' }, qrUrl: '' },
    spec: { printWIn: 5.83, printHIn: 8.27, productName: 'Flyers', slug: 'flyers' }, variation: 0, palette: paletteById('royal-gold'), hasPhoto: false, hasLogo: false, seed: 7,
  });
  for (const id of ENGINE_IDS as EngineId[]) {
    const e = resolveEngine(id, s);
    if (!on[e.vendor]) { results.push(`${e.label}: not connected`); continue; }
    try {
      const t = Date.now();
      const r = await generateArt(art, [id], { free: false }, { ...s, studio_enabled: true });
      results.push(`${e.label}: worked, ${Math.round((Date.now() - t) / 100) / 10}s, ${r.w}×${r.h}, about $${r.usd.toFixed(3)}`);
    } catch (err) {
      results.push(`${e.label}: FAILED, ${(err as Error).message.slice(0, 120)}`);
    }
  }
  return back('/console/studio', { ok: results.join(' | ') });
}

// ---------- the human check ----------
export async function decideReviewAction(fd: FormData) {
  const staff = await requireStaff('review_studio');
  const decision = fd.get('decision') === 'passed' ? 'passed' : 'changes';
  const r = await decideReview(staff.id, String(fd.get('id') ?? ''), decision, String(fd.get('note') ?? '').trim().slice(0, 400));
  revalidatePath('/console/studio/review');
  return back('/console/studio/review', r.ok ? { ok: decision === 'passed' ? 'Passed. The customer has been told.' : 'Sent back with your note. The customer has been told.' } : { e: r.error });
}

export async function flagActionAction(fd: FormData) {
  const staff = await requireStaff('review_studio');
  const id = String(fd.get('id') ?? '');
  const status = fd.get('status') === 'actioned' ? 'actioned' : 'dismissed';
  await query('update studio_flags set status = $2, reviewed_by = $3, reviewed_at = now() where id = $1', [id, status, staff.id]);
  return back('/console/studio/review', { ok: 'Done.' }, '#flags');
}

export async function liftPauseAction(fd: FormData) {
  await requireStaff('review_studio');
  const cid = String(fd.get('customer') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(cid)) return back('/console/studio/review', { e: 'Unknown customer.' }, '#flags');
  await liftPause(cid);
  return back('/console/studio/review', { ok: 'Studio is open again for that customer.' }, '#flags');
}

/** A spot-check of a finished design: fine, or take action. */
export async function sampleAction(fd: FormData) {
  const staff = await requireStaff('review_studio');
  const vid = String(fd.get('version') ?? '');
  const bad = fd.get('verdict') === 'bad';
  const v = await one<{ project_id: string; customer_id: string }>('select v.project_id, p.customer_id from studio_versions v join studio_projects p on p.id = v.project_id where v.id = $1', [vid]);
  if (!v) return back('/console/studio/review', { e: 'Design not found.' }, '#samples');
  if (bad) {
    await query(`insert into studio_flags (customer_id, project_id, version_id, stage, category, verdict, excerpt) values ($1,$2,$3,'output','reviewer','review','Marked by a person during a spot check')`, [v.customer_id, v.project_id, vid]);
  }
  await audit(v.project_id, `staff:${staff.id}`, bad ? 'sample_bad' : 'sample_ok', { version: vid });
  return back('/console/studio/review', { ok: bad ? 'Flagged for follow-up.' : 'Marked fine.' }, '#samples');
}
