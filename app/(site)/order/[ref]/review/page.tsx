import { notFound, redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { PageHead } from '@/components/Bits';
import { ReviewForm } from './ReviewForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leave a review' };

export default async function Review(props: { params: Promise<{ ref: string }> }) {
  const params = await props.params;
  const o = await one<any>('select o.code, o.status, (select 1 from reviews r where r.order_id = o.id) as done from orders o where o.public_token = $1', [params.ref]);
  if (!o) notFound();
  if (o.done) redirect(`/track/${params.ref}`);
  return (
    <>
      <PageHead title="How did we do?" sub={`Order ${o.code}. Two taps, and a few words or a photo if you like.`} />
      <div className="mx-auto max-w-[620px] px-5 pb-12"><ReviewForm token={params.ref} /></div>
    </>
  );
}
