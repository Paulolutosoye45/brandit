import { one, query } from './db';
import { audit, type Who } from './audit';
import type { Business } from './business';

/*
 * Policy pages the team can replace with their own words (for example once a lawyer has reviewed them). The built-in version
 * stays in the code and shows until the team saves their own. Every save keeps the old version, so nothing is lost and any
 * earlier version can be put back. Reverting to the built-in version removes the override but keeps the history.
 */
export const POLICY_PAGES = [
  { slug: 'terms', title: 'Terms and Conditions', path: '/legal/terms' },
  { slug: 'privacy', title: 'Privacy Policy', path: '/legal/privacy' },
  { slug: 'refunds', title: 'Reprints and Refunds', path: '/legal/refunds' },
  { slug: 'ai-designs', title: 'AI designs', path: '/legal/ai-designs' },
] as const;
export type PolicySlug = (typeof POLICY_PAGES)[number]['slug'];
export const isPolicySlug = (s: string): s is PolicySlug => POLICY_PAGES.some((p) => p.slug === s);

export type Override = { slug: string; title: string; body: string; updated_at: string; updated_by: string };
export type Version = { id: number; title: string; body: string; saved_at: string; saved_by: string; note: string };

export async function pageOverride(slug: PolicySlug): Promise<Override | null> {
  try { return await one<Override>('select slug, title, body, updated_at, updated_by from content_pages where slug = $1', [slug]); }
  catch { return null; } // a hiccup shows the built-in page rather than an error
}
export const allOverrides = () => query<Override>('select slug, title, body, updated_at, updated_by from content_pages');
export const pageVersions = (slug: PolicySlug) => query<Version>('select id, title, body, saved_at, saved_by, note from content_page_versions where slug = $1 order by saved_at desc, id desc limit 30', [slug]);

export const MAX_BODY = 60_000;

export async function savePage(who: Who, slug: PolicySlug, d: { title: string; body: string; note?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const title = d.title.replace(/\s+/g, ' ').trim().slice(0, 120);
  const body = d.body.replace(/\r\n/g, '\n').trim();
  if (title.length < 3) return { ok: false, error: 'Give the page a title.' };
  if (body.length < 50) return { ok: false, error: 'The page is too short to publish. If you want the built-in version back, use “Go back to the built-in version”.' };
  if (body.length > MAX_BODY) return { ok: false, error: 'The page is too long. The most it can hold is about 60,000 letters.' };
  const note = (d.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  await query(
    `insert into content_pages (slug, title, body, updated_at, updated_by) values ($1,$2,$3, now(), $4)
     on conflict (slug) do update set title = excluded.title, body = excluded.body, updated_at = now(), updated_by = excluded.updated_by`,
    [slug, title, body, who.name],
  );
  await query('insert into content_page_versions (slug, title, body, saved_by, note) values ($1,$2,$3,$4,$5)', [slug, title, body, who.name, note]);
  await audit(who, { area: 'content', action: 'page_saved', target: title, summary: `Published their own version of ${title}${note ? ` (${note})` : ''}`, detail: { slug, chars: body.length } });
  return { ok: true };
}

export async function revertPage(who: Who, slug: PolicySlug): Promise<void> {
  await query('delete from content_pages where slug = $1', [slug]);
  await audit(who, { area: 'content', action: 'page_reverted', target: slug, summary: `Went back to the built-in version of ${POLICY_PAGES.find((p) => p.slug === slug)?.title}` });
}

export async function restoreVersion(who: Who, slug: PolicySlug, versionId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = await one<Version>('select id, title, body, saved_at, saved_by, note from content_page_versions where id = $1 and slug = $2', [versionId, slug]);
  if (!v) return { ok: false, error: 'That version was not found.' };
  return savePage(who, slug, { title: v.title, body: v.body, note: `Put back the version from ${new Date(v.saved_at).toISOString().slice(0, 10)}` });
}

/** {{whatsapp}}, {{phone}}, {{email}}, {{address}}, {{hours}} and {{reply_within}} in a page are filled in from Business details. */
export const PLACEHOLDERS = ['whatsapp', 'phone', 'email', 'address', 'hours', 'reply_within'] as const;
export function fillPlaceholders(body: string, c: Business): string {
  const v: Record<(typeof PLACEHOLDERS)[number], string> = { whatsapp: c.whatsapp ? `+${c.whatsapp}` : '', phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '', hours: c.hours, reply_within: c.replyWithin };
  return body.replace(/\{\{\s*(whatsapp|phone|email|address|hours|reply_within)\s*\}\}/g, (_, k: keyof typeof v) => v[k]);
}
