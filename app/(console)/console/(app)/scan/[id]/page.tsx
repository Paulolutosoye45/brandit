import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/session';
import { one } from '@/lib/db';
import { moveJob } from '@/lib/jobs';
import { can } from '@/lib/permissions';
import { STAGE_LABEL, type Stage } from '@/lib/types';
import { Notice } from '@/components/Bits';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Scan' };

async function done(fd: FormData) {
  'use server';
  const staff = await requireStaff('scan_print');
  const id = String(fd.get('id'));
  let err: string | null = null;
  try {
    await moveJob(id, 'quality_check', { actor: staff });
  } catch (e) {
    err = (e as Error).message;
  }
  revalidatePath('/console/queue');
  redirect(`/console/scan/${id}?${err ? `e=${encodeURIComponent(err)}` : 'ok=1'}`);
}

export default async function Scan(
  props: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; ok?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const staff = await requireStaff();
  const j = await one<any>(
    `select j.id, j.stage, j.press_id, o.code, o.speed, coalesce(i.label, p.name) as product, i.quantity from jobs j join orders o on o.id = j.order_id
     join order_items i on i.id = j.order_item_id join products p on p.id = i.product_id where j.id = $1`, [params.id]);
  if (!j || (staff.role === 'partner_press' && j.press_id !== staff.press_id)) notFound();
  const stage = j.stage as Stage;
  return (
    <div className="mx-auto max-w-[460px] grid gap-5">
      <div className="card p-6 grid gap-1 text-center shadow-press-sm">
        <p className="font-display font-extrabold text-[44px] leading-none">{j.code}</p>
        <p className="font-bold text-[20px]">{j.quantity.toLocaleString('en-US')} × {j.product}</p>
        <p className="text-muted">Now at: <span className="font-bold text-ink">{STAGE_LABEL[stage]}</span>{j.speed === '24h' ? ' · 24-hour' : ''}</p>
      </div>
      {searchParams.ok && <Notice tone="good">Moved to the quality check. The customer has been updated.</Notice>}
      {searchParams.e && <Notice tone="bad">{searchParams.e}</Notice>}
      {stage === 'printing' && can(staff.role, 'scan_print') && !searchParams.ok ? (
        <form action={done}><input type="hidden" name="id" value={j.id} /><button className="btn-primary w-full !min-h-[72px] text-[22px]">Done printing</button></form>
      ) : (
        <Notice tone="neutral">{stage === 'printing' ? 'Your role cannot move this job.' : `Nothing to scan at this stage. Open the job for the next step.`}</Notice>
      )}
      <Link className="btn-secondary" href={`/console/jobs/${j.id}`}>Open the full job</Link>
    </div>
  );
}
