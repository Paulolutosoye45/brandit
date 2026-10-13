import { redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import { Notice, PageHead } from '@/components/Bits';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Track your order' };

async function find(fd: FormData) {
  'use server';
  const code = String(fd.get('code') ?? '').trim().toUpperCase().replace(/^(\d)/, 'BR-$1');
  const phone = normalizePhone(String(fd.get('phone') ?? ''));
  const o = phone && (await one("select o.public_token from orders o join customers c on c.id = o.customer_id where o.code = $1 and ($2 in (c.phone, c.whatsapp_phone) or o.address->>'contact_phone' = $2)", [code, phone]));
  if (!o) redirect('/track?e=1');
  redirect(`/track/${o.public_token}`);
}

export default async function TrackLookup(props: { searchParams: Promise<{ e?: string }> }) {
  const searchParams = await props.searchParams;
  return (
    <>
      <PageHead title="Track your order" sub="Enter your order code and the mobile number you ordered with." />
      <div className="mx-auto max-w-[520px] px-5 pb-12">
        <form action={find} className="card p-6 grid gap-4">
          {searchParams.e && <Notice tone="bad">We could not match that code and number. Check the code in your WhatsApp message, for example BR-1042.</Notice>}
          <div><label className="label" htmlFor="code">Order code</label><input id="code" name="code" className="field" placeholder="BR-1042" required /></div>
          <div><label className="label" htmlFor="phone">Mobile number</label><input id="phone" name="phone" className="field" inputMode="tel" placeholder="0803 123 4567" required /></div>
          <button className="btn-primary" type="submit">Find my order</button>
        </form>
      </div>
    </>
  );
}
