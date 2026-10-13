import { one, query, tx } from '../db';
import { getSettings } from '../settings';
import { audit } from './projects';
import { ensureCredit, resumeCredit, pauseCredit } from './purchases';
import { notifyChanges, notifyChecked } from './notify';
import { lagosDayStart } from './config';

/* The human check: a Brandit designer looks at the approved design and either passes it or leaves a note. */
export type ReviewRow = {
  id: string; project_id: string; version_id: string; status: 'waiting' | 'passed' | 'changes'; note: string | null; requested_at: string; decided_at: string | null;
  title: string; tier: string | null; product_slug: string; customer_name: string | null; preview_key: string | null; final_key: string | null; sha256: string | null; check_result: any; brief: any; checked_by: string | null;
};

export const listReviews = (status: 'waiting' | 'done', limit = 60) =>
  query<ReviewRow>(
    `select r.*, p.title, p.tier, p.product_slug, p.brief, c.name as customer_name, v.preview_key, v.final_key, v.sha256, v.check_result, s.name as checked_by
     from studio_reviews r join studio_projects p on p.id = r.project_id join customers c on c.id = p.customer_id join studio_versions v on v.id = r.version_id left join staff s on s.id = r.staff_id
     where ${status === 'waiting' ? "r.status = 'waiting'" : "r.status <> 'waiting'"} order by ${status === 'waiting' ? 'r.requested_at asc' : 'r.decided_at desc'} limit $1`,
    [limit],
  );

export async function reviewLoad() {
  const s = await getSettings();
  const w = await one<{ n: string }>("select count(*) as n from studio_reviews where status = 'waiting'");
  const t = await one<{ n: string }>('select count(*) as n from studio_reviews where decided_at >= $1', [lagosDayStart().toISOString()]);
  const waiting = Number(w?.n ?? 0), doneToday = Number(t?.n ?? 0);
  return { waiting, doneToday, cap: s.studio_check_daily_cap, hours: s.studio_check_hours, full: s.studio_check_daily_cap > 0 && waiting + doneToday > s.studio_check_daily_cap };
}

export async function decideReview(staffId: string, reviewId: string, decision: 'passed' | 'changes', note: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await one<{ id: string; project_id: string; status: string }>('select id, project_id, status from studio_reviews where id = $1', [reviewId]);
  if (!r) return { ok: false, error: 'That review was not found.' };
  if (r.status !== 'waiting') return { ok: false, error: 'This design was already decided.' };
  const text = note.replace(/\s+/g, ' ').trim().slice(0, 400);
  if (decision === 'changes' && text.length < 5) return { ok: false, error: 'Write what needs to change, so the customer knows what to fix.' };
  await tx(async (q) => {
    await q.query('update studio_reviews set status = $2, note = $3, staff_id = $4, decided_at = now() where id = $1', [reviewId, decision, text || null, staffId]);
    if (decision === 'changes') {
      await q.query("update studio_projects set status = 'active', approved_version_id = null, approved_sha256 = null, approved_at = null, spelling_confirmed_at = null where id = $1", [r.project_id]);
    }
    await q.query('insert into studio_audit (project_id, actor, action, detail) values ($1,$2,$3,$4)', [r.project_id, `staff:${staffId}`, `review_${decision}`, JSON.stringify({ note: text })]);
  });
  if (decision === 'passed') {
    await resumeCredit(r.project_id);
    await ensureCredit(r.project_id);
    await notifyChecked(r.project_id).catch(() => {});
  } else {
    await pauseCredit(r.project_id);
    await notifyChanges(r.project_id, text).catch(() => {});
  }
  return { ok: true };
}
void audit;
