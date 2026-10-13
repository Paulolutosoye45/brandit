import { notFound, redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { decideProof } from '@/lib/jobs';
import { Notice, PageHead } from '@/components/Bits';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your proof' };

async function decide(fd: FormData) {
  'use server';
  const token = String(fd.get('token'));
  const decision = String(fd.get('decision')) === 'approve' ? 'approved' : 'changes_requested';
  const r = await decideProof(token, decision, String(fd.get('note') ?? ''));
  const p = await one('select o.public_token from proofs p join order_items i on i.id = p.order_item_id join orders o on o.id = i.order_id where p.token = $1', [token]);
  if (!r.ok) redirect(`/proof/${token}?e=${encodeURIComponent(r.error ?? 'Something went wrong.')}`);
  redirect(`/track/${p!.public_token}`);
}

export default async function ProofPage(
  props: { params: Promise<{ token: string }>; searchParams: Promise<{ e?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const p = await one<any>(
    `select p.*, f.mime, o.code, o.public_token, coalesce(i.label, pr.name) as product_name from proofs p join files f on f.id = p.file_id
     join order_items i on i.id = p.order_item_id join orders o on o.id = i.order_id join products pr on pr.id = i.product_id where p.token = $1`,
    [params.token],
  );
  if (!p) notFound();
  const latest = await one<{ id: string }>('select id from proofs where order_item_id = $1 order by version desc limit 1', [p.order_item_id]);
  const current = latest?.id === p.id && p.status === 'sent';
  const src = `/api/files/${p.file_id}?p=${params.token}`;
  return (
    <>
      <PageHead title="Check your proof" sub={`${p.product_name} · order ${p.code} · version ${p.version}`} />
      <div className="mx-auto max-w-[760px] px-5 pb-12 grid gap-5">
        {searchParams.e && <Notice tone="bad">{searchParams.e}</Notice>}
        <div className="card p-4 grid gap-3">
          {p.mime === 'application/pdf' ? (
            <a className="btn-secondary" href={src} target="_blank" rel="noreferrer">Open your proof (PDF)</a>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="Your proof" className="w-full rounded-sm2 bg-placeholder max-h-[560px] object-contain" />
          )}
          <p className="text-[14px] text-muted">Check the spelling, phone numbers, colours and layout. We print exactly what you approve.</p>
        </div>
        {current ? (
          <form action={decide} className="card p-5 grid gap-4">
            <input type="hidden" name="token" value={params.token} />
            <button name="decision" value="approve" className="btn-primary">Approve and start printing</button>
            <div className="border-t border-line pt-4 grid gap-3">
              <label className="label !mb-0" htmlFor="note">Want something changed?</label>
              <textarea id="note" name="note" className="field !py-3 min-h-[96px]" placeholder="Tell us exactly what to change" />
              <button name="decision" value="changes" className="btn-secondary">Ask for changes</button>
            </div>
          </form>
        ) : (
          <Notice tone="neutral">{p.status === 'approved' ? 'You approved this proof. Thank you.' : p.status === 'changes_requested' ? 'You asked for changes. We will send a new proof.' : 'A newer proof has been sent. Please use the latest link in your messages.'}</Notice>
        )}
        <a className="font-bold underline" href={`/track/${p.public_token}`}>Back to your order</a>
      </div>
    </>
  );
}
