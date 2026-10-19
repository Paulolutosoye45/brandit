import { notFound, redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { createClaim } from '@/lib/claims';
import { saveSimpleFile } from '@/lib/artwork';
import { Notice, PageHead } from '@/components/Bits';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Report a problem' };

async function report(fd: FormData) {
  'use server';
  const token = String(fd.get('token'));
  const o = await one<any>('select o.id, i.id as item_id from orders o join order_items i on i.order_id = o.id where o.public_token = $1', [token]);
  if (!o) redirect('/track');
  let photo: string | null = null;
  const f = fd.get('photo');
  if (f instanceof File && f.size > 0) {
    const r = await saveSimpleFile(o.id, o.item_id, 'claim_photo', { name: f.name, type: f.type, buf: Buffer.from(await f.arrayBuffer()) });
    if (!r.ok) redirect(`/order/${token}/problem?e=${encodeURIComponent(r.error)}`);
    photo = r.fileId;
  }
  const kind = (['wrong_print', 'damaged', 'other'] as const).find((k) => k === String(fd.get('kind'))) ?? 'other';
  const itemId = String(fd.get('item') ?? '');
  const r = await createClaim(token, { kind, description: String(fd.get('description') ?? ''), photoFileId: photo, itemId: /^[0-9a-f-]{36}$/.test(itemId) ? itemId : null });
  if (!r.ok) redirect(`/order/${token}/problem?e=${encodeURIComponent(r.error)}`);
  redirect(`/track/${token}?reported=1`);
}

export default async function Problem(
  props: { params: Promise<{ ref: string }>; searchParams: Promise<{ e?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const o = await one('select id, code, status from orders where public_token = $1', [params.ref]);
  if (!o) notFound();
  const lines = await query<{ id: string; name: string; quantity: number }>('select i.id, coalesce(i.label, p.name) as name, i.quantity from order_items i join products p on p.id = i.product_id where i.order_id = $1 order by i.position, i.id', [o.id]);
  return (
    <>
      <PageHead title="Report a problem" sub={`Order ${o.code}. Tell us what is not right and a person will look at it today.`} />
      <div className="mx-auto max-w-[620px] px-5 pb-12">
        <form action={report} className="card p-6 grid gap-5">
          <input type="hidden" name="token" value={params.ref} />
          {searchParams.e && <Notice tone="bad">{searchParams.e}</Notice>}
          {lines.length > 1 && (
            <div>
              <label className="label" htmlFor="item">Which product is it about?</label>
              <select id="item" name="item" className="field" defaultValue="">
                <option value="">The whole order</option>
                {lines.map((l) => <option key={l.id} value={l.id}>{l.name} × {l.quantity.toLocaleString('en-US')}</option>)}
              </select>
            </div>
          )}
          <fieldset className="grid gap-2">
            <legend className="label">What happened?</legend>
            {[['wrong_print', 'It does not match the file I approved'], ['damaged', 'It arrived damaged'], ['other', 'Something else']].map(([v, l], i) => (
              <label key={v} className="flex items-center gap-3 min-h-[44px] cursor-pointer"><input type="radio" name="kind" value={v} defaultChecked={i === 0} className="h-5 w-5 accent-[#0B1F33]" />{l}</label>
            ))}
          </fieldset>
          <div><label className="label" htmlFor="d">Tell us what is wrong</label><textarea id="d" name="description" className="field !py-3 min-h-[110px]" required /></div>
          <div><label className="label" htmlFor="p">A photo helps <span className="font-normal">(optional)</span></label><input id="p" name="photo" type="file" accept="image/jpeg,image/png" className="field !py-2.5" /></div>
          <button className="btn-primary" type="submit">Send report</button>
          <p className="text-[14px] text-muted">If we got it wrong, we reprint it or refund you. You do not have to argue for it.</p>
        </form>
      </div>
    </>
  );
}
