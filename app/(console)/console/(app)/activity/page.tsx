import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { recentAudit, AREA_LABEL } from '@/lib/audit';
import { describeWhen } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Activity log' };

const PAGE = 50;

export default async function ActivityPage(props: { searchParams: Promise<{ area?: string; q?: string; p?: string }> }) {
  await requireStaff('see_activity');
  const sp = await props.searchParams;
  const area = sp.area && sp.area in AREA_LABEL ? sp.area : 'all';
  const q = (sp.q ?? '').trim().slice(0, 80);
  const page = Math.max(1, Math.min(Number(sp.p) || 1, 200));
  const { rows, more } = await recentAudit({ area, q, limit: PAGE, offset: (page - 1) * PAGE });
  const href = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set('q', q);
    if (area !== 'all') u.set('area', area);
    if (p > 1) u.set('p', String(p));
    const s = u.toString();
    return `/console/activity${s ? `?${s}` : ''}`;
  };
  const areaHref = (a: string) => {
    const u = new URLSearchParams();
    if (q) u.set('q', q);
    if (a !== 'all') u.set('area', a);
    const s = u.toString();
    return `/console/activity${s ? `?${s}` : ''}`;
  };

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[34px]">Activity log</h1>
        <p className="text-muted">Who changed what, newest first. Price changes are here too. Nobody can edit or delete this list.</p>
      </div>

      <form className="flex max-w-[560px] gap-3" role="search">
        <input name="q" defaultValue={q} className="field" placeholder="A name, a product or a word" aria-label="Search the activity log" />
        {area !== 'all' && <input type="hidden" name="area" value={area} />}
        <button className="btn-dark">Search</button>
      </form>

      <nav aria-label="Area" className="flex flex-wrap gap-2">
        {[['all', 'Everything'], ...Object.entries(AREA_LABEL)].map(([k, v]) => (
          <Link key={k} href={areaHref(k)} aria-current={k === area ? 'true' : undefined}
            className={`inline-flex min-h-[44px] items-center rounded-full border-2 px-4 font-bold ${k === area ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{v}</Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="card p-6 text-muted">Nothing here{q || area !== 'all' ? ' for that search' : ' yet'}. Changes made in the console will show up here.</div>
      ) : (
        <ul className="grid gap-3" aria-label="Changes">
          {rows.map((r, i) => (
            <li key={`${r.at}-${i}`} className="card grid gap-1 p-4">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-bold">{r.actor}</span>
                <span className="pill">{AREA_LABEL[r.area as keyof typeof AREA_LABEL] ?? r.area}</span>
                <time className="text-[14px] text-muted sm:ml-auto" dateTime={new Date(r.at).toISOString()}>{describeWhen(new Date(r.at))}</time>
              </p>
              <p className="break-words">{r.summary}</p>
            </li>
          ))}
        </ul>
      )}

      {(page > 1 || more) && (
        <nav className="flex items-center justify-between gap-3" aria-label="Pages">
          {page > 1 ? <Link className="btn-dark" href={href(page - 1)}>Newer</Link> : <span />}
          <span className="text-muted">Page {page}</span>
          {more ? <Link className="btn-dark" href={href(page + 1)}>Older</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
