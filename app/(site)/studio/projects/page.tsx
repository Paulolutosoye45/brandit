import Link from 'next/link';
import type { Metadata } from 'next';
import { requireCustomer } from '@/lib/session';
import { listProjects } from '@/lib/studio/projects';
import { occasionById } from '@/content/studio';
import { walletOf } from '@/lib/studio/purchases';
import { describeWhen } from '@/lib/time';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My designs', robots: { index: false } };

const STATUS: Record<string, [string, string]> = {
  draft: ['Not unlocked yet', 'bg-placeholder text-ink'], active: ['In progress', 'bg-warn-tint text-warn'], approved: ['Approved', 'bg-good-tint text-good'], archived: ['Closed', 'bg-placeholder text-ink'],
};

export default async function MyDesigns() {
  const c = await requireCustomer('/studio/projects');
  const [list, wallet, st] = await Promise.all([listProjects(c.id), walletOf(c.id), getSettings()]);
  return (
    <div className="mx-auto grid max-w-[1160px] gap-6 px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/studio" className="text-[14px] text-muted underline">Brandit Studio</Link>
          <h1 className="mt-1 text-[34px] leading-tight sm:text-[44px]">My designs</h1>
          {wallet > 0 && <p className="mt-1 text-[16px] text-muted">You have <strong>{wallet}</strong> Standard {wallet === 1 ? 'design' : 'designs'} left in your pack. They never expire.</p>}
        </div>
        <Link href="/studio/new" className="btn-primary">Start a design</Link>
      </div>
      {list.length === 0 ? (
        <div className="card p-6"><p className="text-muted">You have not started a design yet. It takes about two minutes to see your first free sketch.</p></div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => {
            const [label, cls] = STATUS[p.status] ?? STATUS.draft;
            return (
              <li key={p.id}>
                <Link href={`/studio/p/${p.id}`} className="card grid h-full content-start gap-3 overflow-hidden hover:border-ink">
                  <div className="grid aspect-[4/3] place-items-center bg-paper2">
                    {p.cover_key ? <img src={`/api/studio/p/${p.id}/cover`} alt="" className="h-full w-full object-contain" loading="lazy" /> : <span className="text-[14px] text-muted">No picture yet</span>}
                  </div>
                  <div className="grid gap-1 p-4 pt-0">
                    <p className="line-clamp-2 font-display text-[19px] font-extrabold leading-tight">{p.title || occasionById(p.occasion).label}</p>
                    <p className="text-[14px] text-muted">{occasionById(p.occasion).label} · {p.product_slug.replace(/-/g, ' ')}</p>
                    <div className="flex flex-wrap items-center gap-2"><span className={`pill ${cls}`}>{label}</span>{p.tier && <span className="pill bg-placeholder text-ink capitalize">{p.tier}</span>}</div>
                    <p className="text-[13px] text-muted">Last changed {describeWhen(new Date(p.last_activity_at))}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[14px] text-muted">Designs, words and pictures are deleted {st.studio_keep_days} days after you last open them. Print files for orders you paid for are kept with the order.</p>
    </div>
  );
}
