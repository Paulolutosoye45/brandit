import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { query } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { Notice } from '@/components/Bits';
import { describeWhen } from '@/lib/time';
import { occasionById } from '@/content/studio';
import { CATEGORY_LABEL, type Category } from '@/content/studio-policy';
import { listReviews, reviewLoad } from '@/lib/studio/reviews';
import { decideReviewAction, flagActionAction, liftPauseAction, sampleAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Studio checks' };

function Words({ brief }: { brief: any }) {
  const occ = occasionById(brief?.occasion ?? 'other');
  const rows = occ.lines.filter((l) => brief?.lines?.[l.id]);
  if (!rows.length) return <p className="text-[14px] text-muted">No words.</p>;
  return <dl className="grid gap-1 rounded-sm2 bg-paper2 p-3">{rows.map((l) => <div key={l.id}><dt className="text-[12px] font-bold uppercase text-muted">{l.label}</dt><dd className="text-[17px] font-bold">{brief.lines[l.id]}</dd></div>)}</dl>;
}

export default async function StudioReview(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('review_studio');
  const s = await getSettings();
  const [load, waiting, done] = await Promise.all([reviewLoad(), listReviews('waiting'), listReviews('done', 12)]);
  const flags = await query<any>(
    `select f.*, c.name as cname, c.studio_blocked_until, (select count(*) from studio_flags x where x.customer_id = f.customer_id and x.verdict = 'block' and x.created_at > now() - interval '30 days') as strikes
     from studio_flags f left join customers c on c.id = f.customer_id where f.status = 'open' order by f.created_at desc limit 60`);
  const samples = s.studio_review_mode === 'off' ? [] : (await query<any>(
    `select v.id, v.kind, v.created_at, v.check_result, p.id as project_id, p.title, p.tier, p.product_slug, p.brief, c.name as cname
     from studio_versions v join studio_projects p on p.id = v.project_id join customers c on c.id = p.customer_id
     where v.status = 'ready' and v.kind <> 'sketch' and v.preview_key is not null and v.created_at > now() - interval '3 days'
       and not exists (select 1 from studio_audit a where a.project_id = p.id and a.action in ('sample_ok','sample_bad') and a.detail->>'version' = v.id::text)
     order by v.created_at desc limit 80`)).filter((v) => s.studio_review_mode === 'all' || parseInt(String(v.id).slice(-1), 16) % 5 === 0).slice(0, 20);

  return (
    <div className="grid max-w-[1080px] gap-10">
      <div><Link href="/console/studio" className="text-[14px] text-muted underline">Brandit Studio</Link><h1 className="mt-1 text-[34px]">Studio checks</h1><p className="text-muted">Designs a customer approved that a Brandit designer must look at before it can be ordered, anything the content rules stopped, and spot checks of what the picture makers made.</p></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Waiting', String(load.waiting)], ['Done today', String(load.doneToday)], ['Daily limit', load.cap > 0 ? String(load.cap) : 'none'], ['Hours we promise', s.studio_check_hours]].map(([l, v]) => <div key={l} className="card p-4"><p className="text-[13px] font-bold text-muted">{l}</p><p className="font-display text-[22px] font-extrabold leading-tight">{v}</p></div>)}
      </div>
      {load.full && <Notice tone="warn">Today is over the daily limit of {load.cap} checks. Customers are told theirs may take until the next working day.</Notice>}

      <section aria-labelledby="w-h" className="grid gap-4"><h2 id="w-h" className="text-[24px]">Designs to check ({waiting.length})</h2>
        {waiting.length === 0 && <div className="card p-8 text-center text-muted">Nothing is waiting.</div>}
        {waiting.map((r) => (
          <article key={r.id} className="card grid gap-4 p-5 md:grid-cols-[260px_1fr]">
            <a href={`/api/studio/v/${r.version_id}?k=preview`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-sm2 border border-line bg-paper2"><img src={`/api/studio/v/${r.version_id}?k=preview`} alt="The design to check" className="w-full object-contain" /></a>
            <div className="grid content-start gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="text-[19px] font-bold">{r.title || 'Untitled'} <span className="pill ml-1 bg-placeholder text-ink capitalize">{r.tier}</span></p><p className="text-[14px] text-muted">{r.customer_name} · {r.product_slug.replace(/-/g, ' ')} · asked {describeWhen(new Date(r.requested_at))}</p></div>
                <a className="btn-secondary btn-sm" href={`/api/studio/v/${r.version_id}?k=final`}>Open the print file</a>
              </div>
              <Words brief={r.brief} />
              {r.check_result?.headline && <p className="text-[14px]"><span className="font-bold">Sharpness check:</span> {r.check_result.headline} <span className="text-muted">Fingerprint {String(r.sha256 ?? '').slice(0, 12)}</span></p>}
              <ul className="grid gap-0.5 text-[13px] text-muted">{(r.check_result?.lines ?? []).filter((l: any) => l.status !== 'pass').map((l: any) => <li key={l.id}>{l.status === 'stop' ? '✕' : '!'} {l.label}: {l.message}</li>)}</ul>
              <form action={decideReviewAction} className="grid gap-3 border-t border-line pt-3">
                <input type="hidden" name="id" value={r.id} />
                <div><label className="label" htmlFor={`n-${r.id}`}>Note for the customer (needed if you send it back)</label><input id={`n-${r.id}`} name="note" className="field" maxLength={400} placeholder="For example: the venue line is cut off on the right" /></div>
                <div className="flex flex-wrap gap-2"><button name="decision" value="passed" className="btn-primary btn-sm">Pass: ready to print</button><button name="decision" value="changes" className="btn-secondary btn-sm">Send back with this note</button></div>
              </form>
            </div>
          </article>
        ))}
      </section>

      <section id="flags" aria-labelledby="f-h" className="grid gap-4 scroll-mt-6"><h2 id="f-h" className="text-[24px]">Stopped requests ({flags.length})</h2>
        <p className="-mt-2 text-[14px] text-muted">The content rules stopped these, or marked them for a look. After {s.studio_strike_limit} stopped requests in 30 days an account is paused automatically.</p>
        {flags.length === 0 && <div className="card p-8 text-center text-muted">Nothing open.</div>}
        {flags.map((f) => {
          const paused = f.studio_blocked_until && new Date(f.studio_blocked_until) > new Date();
          return (
            <div key={f.id} className="card flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-bold">{CATEGORY_LABEL[f.category as Category] ?? f.category} <span className="pill ml-1 bg-placeholder text-ink">{f.stage}</span> <span className={`pill ml-1 ${f.verdict === 'block' ? 'bg-bad-tint text-bad' : 'bg-warn-tint text-warn'}`}>{f.verdict === 'block' ? 'stopped' : 'to look at'}</span></p>
                <p className="text-[14px] text-muted">{f.cname ?? 'Unknown'} · {describeWhen(new Date(f.created_at))} · {f.strikes} stopped in 30 days{paused ? ' · PAUSED' : ''}</p>
                {f.excerpt && <p className="mt-1 break-words rounded-sm2 bg-paper2 px-3 py-1.5 text-[14px]">“{f.excerpt}”</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <form action={flagActionAction}><input type="hidden" name="id" value={f.id} /><button name="status" value="dismissed" className="btn-secondary btn-sm">Fine, dismiss</button></form>
                <form action={flagActionAction}><input type="hidden" name="id" value={f.id} /><button name="status" value="actioned" className="btn-secondary btn-sm">Action taken</button></form>
                {paused && f.customer_id && <form action={liftPauseAction}><input type="hidden" name="customer" value={f.customer_id} /><button className="btn-primary btn-sm">Lift the pause</button></form>}
              </div>
            </div>
          );
        })}
      </section>

      {s.studio_review_mode !== 'off' && (
        <section id="samples" aria-labelledby="s-h" className="grid gap-4 scroll-mt-6"><h2 id="s-h" className="text-[24px]">Spot checks ({samples.length})</h2>
          <p className="-mt-2 text-[14px] text-muted">{s.studio_review_mode === 'all' ? 'Every paid design from the last three days.' : 'About one in five paid designs from the last three days.'} Look for anything the rules should have caught: faces, text in the picture, anything that looks official or political. “Flag” adds it to the list above.</p>
          {samples.length === 0 && <div className="card p-8 text-center text-muted">Nothing to look at.</div>}
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {samples.map((v) => (
              <li key={v.id} className="card grid gap-2 overflow-hidden p-2">
                <a href={`/api/studio/v/${v.id}?k=preview`} target="_blank" rel="noreferrer" className="block bg-paper2"><img src={`/api/studio/v/${v.id}?k=preview`} alt="A paid design" className="aspect-[3/4] w-full object-contain" loading="lazy" /></a>
                <p className="truncate px-1 text-[13px] font-bold">{v.title || 'Untitled'}</p>
                <form action={sampleAction} className="flex gap-2 px-1 pb-1"><input type="hidden" name="version" value={v.id} /><button name="verdict" value="ok" className="btn-secondary btn-sm grow">Fine</button><button name="verdict" value="bad" className="btn-secondary btn-sm grow">Flag</button></form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="d-h" className="grid gap-3"><h2 id="d-h" className="text-[22px]">Recently decided</h2>
        <div className="card overflow-x-auto"><table className="w-full min-w-[560px] text-left text-[15px]"><tbody>
          {done.length === 0 && <tr><td className="px-4 py-6 text-center text-muted">Nothing yet.</td></tr>}
          {done.map((r) => <tr key={r.id} className="border-b border-line last:border-0"><td className="px-4 py-2 font-bold">{r.title || 'Untitled'}</td><td className="px-4 py-2"><span className={`pill ${r.status === 'passed' ? 'bg-good-tint text-good' : 'bg-warn-tint text-warn'}`}>{r.status === 'passed' ? 'Passed' : 'Sent back'}</span></td><td className="px-4 py-2 text-muted">{r.note}</td><td className="px-4 py-2 text-muted">{r.checked_by}</td><td className="px-4 py-2 text-muted">{r.decided_at ? describeWhen(new Date(r.decided_at)) : ''}</td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}
