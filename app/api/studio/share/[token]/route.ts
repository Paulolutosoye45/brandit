import { query } from '@/lib/db';
import { getProjectByShare } from '@/lib/studio/projects';
import { notifyFeedback } from '@/lib/studio/notify';
import { ipOf, limited } from '@/lib/ratelimit';
import { bad, good, jsonBody } from '@/lib/studio/route';
import { moderateTextRemote, scanText } from '@/lib/studio/moderation';

export const dynamic = 'force-dynamic';

/** A family member or committee member says "I like it" or "please change this", without signing in. */
export async function POST(req: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return bad('Not found', 404);
  if (limited(`studio:fb:${ipOf(req)}`, 8, 60 * 60_000)) return bad('You have sent a lot of comments. Please try again later.', 429);
  const p = await getProjectByShare(token);
  if (!p || !p.shared_version_id) return bad('This link is no longer active.', 404);
  const b = await jsonBody(req);
  if (!b) return bad('Something went wrong. Try again.');
  const name = String(b.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const verdict = b.verdict === 'like' ? 'like' : b.verdict === 'changes' ? 'changes' : null;
  const note = String(b.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!name) return bad('Please type your name so they know who it is from.');
  if (!verdict) return bad('Choose "I like it" or "Please change something".');
  if (verdict === 'changes' && note.length < 3) return bad('Tell them what to change.');
  // The note is shown to the owner, so it gets the same content check as anything else on the platform.
  if (scanText(`${name} ${note}`, { scope: 'words' }).some((f) => f.verdict === 'block')) return bad('That comment cannot be sent.', 422);
  const remote = await moderateTextRemote(`${name} ${note}`);
  if (remote.verdict === 'block') return bad('That comment cannot be sent.', 422);
  const count = await query<{ n: string }>('select count(*) as n from studio_feedback where project_id = $1', [p.id]);
  if (Number(count[0]?.n ?? 0) >= 60) return bad('This design has enough comments already.', 429);
  await query('insert into studio_feedback (project_id, version_id, name, verdict, note) values ($1,$2,$3,$4,$5)', [p.id, p.shared_version_id, name, verdict, note || null]);
  await notifyFeedback(p.id, name, verdict === 'like' ? 'likes it' : 'asked for a change').catch(() => {});
  return good();
}
