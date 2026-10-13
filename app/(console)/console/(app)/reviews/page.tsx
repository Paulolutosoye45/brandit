import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { can } from '@/lib/permissions';
import { query } from '@/lib/db';
import { Notice } from '@/components/Bits';
import { moderatePhoto, pendingPhotos, ReviewError } from '@/lib/reviewPhotos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reviews' };

async function feature(fd: FormData) {
  'use server';
  await requireStaff('reply');
  const on = fd.get('on') === '1';
  await query('update reviews set featured = $2 where id = $1 and public_ok', [String(fd.get('id')), on]);
  revalidatePath('/');
  revalidatePath('/console/reviews');
  redirect(`/console/reviews?ok=${encodeURIComponent(on ? 'Now shown on the home page.' : 'Removed from the home page.')}`);
}

async function checkPhoto(fd: FormData) {
  'use server';
  const staff = await requireStaff('moderate_photos');
  const decision = fd.get('decision') === 'approve' ? 'approve' : 'reject';
  try {
    await moderatePhoto(String(fd.get('id')), staff.id, decision);
  } catch (e) {
    if (e instanceof ReviewError) redirect(`/console/reviews?e=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath('/');
  revalidatePath('/console/reviews');
  redirect(`/console/reviews?ok=${encodeURIComponent(decision === 'approve' ? 'Photo approved. It shows on the website only if the customer agreed and you also pick the review for the home page.' : 'Photo rejected and deleted.')}`);
}

export default async function Reviews(props: { searchParams: Promise<{ ok?: string; e?: string }> }) {
  const sp = await props.searchParams;
  const staff = await requireStaff('reply');
  const canPhotos = can(staff.role, 'moderate_photos');
  const [rows, pending] = await Promise.all([
    query<any>(
      `select r.id, r.rating, r.body, r.public_ok, r.photo_public_ok, r.photo_status, r.featured, r.created_at, o.code, coalesce(i.label, p.name) as product, split_part(coalesce(c.name, ''), ' ', 1) as first_name
       from reviews r join orders o on o.id = r.order_id join order_items i on i.order_id = o.id join products p on p.id = i.product_id left join customers c on c.id = o.customer_id
       order by r.created_at desc limit 100`,
    ),
    canPhotos ? pendingPhotos() : Promise.resolve([]),
  ]);
  return (
    <div className="grid gap-6 max-w-[900px]">
      <div><h1 className="text-[34px]">Reviews</h1><p className="text-muted">Customers who agreed can have their words shown on the home page. You choose which ones. Pick the real, specific ones: a name, a product, what went well.</p></div>
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}

      {canPhotos && pending.length > 0 && (
        <section aria-labelledby="photos-h" className="grid gap-3">
          <div>
            <h2 id="photos-h" className="text-[22px]">Photos to check ({pending.length})</h2>
            <p className="text-[14px] text-muted">Look at each photo before it can appear anywhere. Reject any photo with a face, a phone number, a plate number, a document or anything that is not the printed item. Rejected photos are deleted. Photos nobody checks are deleted after 60 days.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {pending.map((p) => (
              <li key={p.id} className="card grid gap-3 p-4">
                <a href={`/api/review-photos/${p.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line bg-paper">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/review-photos/${p.id}?size=thumb`} alt={`Review photo for order ${p.code}`} className="h-[220px] w-full object-contain" loading="lazy" />
                </a>
                <p className="text-[14px]"><b>{p.code}</b> · {p.product} · {'★'.repeat(p.rating)}</p>
                {p.body && <p className="text-[14px] text-muted line-clamp-3">{p.body}</p>}
                <p className="text-[13px] text-muted">{p.photo_public_ok ? 'Customer agreed to show this photo on the website.' : 'Customer did not agree to show it. It stays private.'}</p>
                <div className="flex gap-2">
                  <form action={checkPhoto} className="flex-1"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="decision" value="approve" /><button className="btn-dark btn-sm w-full">Approve</button></form>
                  <form action={checkPhoto} className="flex-1"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="decision" value="reject" /><button className="btn-secondary btn-sm w-full">Reject</button></form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length === 0 && <div className="card p-8 text-center text-muted">No reviews yet. They arrive two hours after each delivery.</div>}
      <ul className="grid gap-3">
        {rows.map((r) => (
          <li key={r.id} className="card p-4 sm:p-5 grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} <span className="text-muted font-normal text-[14px]">· {r.code} · {r.product}</span></p>
              <div className="flex gap-2">
                {r.photo_status === 'approved' && <span className="pill">Photo approved</span>}
                {r.photo_status === 'pending' && <span className="pill">Photo waiting</span>}
                {r.featured && <span className="pill bg-good-tint text-good">On the home page</span>}
              </div>
            </div>
            <p className={r.body ? '' : 'text-muted'}>{r.body || 'No words, just a rating.'}</p>
            <div className="flex flex-wrap items-center gap-3 text-[14px] text-muted">
              <span>{r.first_name || 'Customer'}</span>
              <span>{r.public_ok ? 'Agreed to be shown' : 'Did not agree to be shown'}</span>
              {r.photo_status === 'approved' && <span>{r.photo_public_ok ? 'Photo can be shown' : 'Photo stays private'}</span>}
              {r.public_ok && r.body && (
                <form action={feature}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="on" value={r.featured ? '0' : '1'} /><button className="btn-secondary btn-sm">{r.featured ? 'Remove from home page' : 'Show on home page'}</button></form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
