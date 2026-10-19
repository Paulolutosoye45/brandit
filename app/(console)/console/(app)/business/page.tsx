import { requireStaff } from '@/lib/session';
import { businessForm, makeBusiness } from '@/lib/business';
import { Notice } from '@/components/Bits';
import { saveBusinessAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Business details' };

export default async function BusinessPage(props: { searchParams: Promise<{ e?: string; ok?: string; field?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('manage_business');
  const f = await businessForm();
  const shown = makeBusiness(f);
  const bad = (k: string) => (sp.field === k ? { 'aria-invalid': true as const } : {});
  return (
    <div className="grid max-w-[760px] gap-6">
      <div><h1 className="text-[34px]">Business details</h1><p className="text-muted">The contact details customers see on the site, in messages and on the legal pages. Change them here and they change everywhere at once. No developer, no redeploy.</p></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      <form action={saveBusinessAction} className="card grid gap-5 p-6">
        <div>
          <label className="label" htmlFor="whatsapp">WhatsApp number</label>
          <input id="whatsapp" name="whatsapp" inputMode="tel" defaultValue={f.whatsapp ? `+${f.whatsapp}` : ''} placeholder="0803 123 4567" className="field" {...bad('whatsapp')} />
          <p className="mt-1 text-[14px] text-muted">Shows the green WhatsApp button, the “Order on WhatsApp” link and the contact page. {!f.whatsapp && shown.whatsapp ? `Right now the site uses +${shown.whatsapp} from your hosting settings; typing a number here replaces it.` : ''}</p>
        </div>
        <div>
          <label className="label" htmlFor="phone">Phone number to call (optional)</label>
          <input id="phone" name="phone" inputMode="tel" defaultValue={f.phone} placeholder="0803 123 4567" className="field" {...bad('phone')} />
        </div>
        <div>
          <label className="label" htmlFor="email">Support email (optional)</label>
          <input id="email" name="email" type="email" defaultValue={f.email} placeholder="hello@thebrandit.ng" className="field" {...bad('email')} />
          <p className="mt-1 text-[14px] text-muted">{!f.email && shown.email ? `Right now the site uses ${shown.email} from your hosting settings.` : 'Shown on the contact page and the legal pages.'}</p>
        </div>
        <div>
          <label className="label" htmlFor="address">Business address (optional)</label>
          <textarea id="address" name="address" rows={2} defaultValue={f.address} className="field py-3" placeholder="Street, area, Lagos" maxLength={240} />
          <p className="mt-1 text-[14px] text-muted">{!f.address && shown.address ? `Right now the site uses the address from your hosting settings.` : 'Only fill this in if customers can visit or collect. It appears on the contact and legal pages.'}</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div><label className="label" htmlFor="hours">Opening hours</label><input id="hours" name="hours" defaultValue={f.hours} placeholder="Monday to Saturday, 8am to 6pm" className="field" maxLength={120} /><p className="mt-1 text-[14px] text-muted">Blank uses “{shown.hours}”.</p></div>
          <div><label className="label" htmlFor="reply_within">We reply within</label><input id="reply_within" name="reply_within" defaultValue={f.reply_within} placeholder="15 minutes" className="field" maxLength={60} /><p className="mt-1 text-[14px] text-muted">Only promise what you keep. Blank uses “{shown.replyWithin}”.</p></div>
        </div>
        <div className="rounded-md2 border border-line bg-paper2 p-4">
          <label className="flex min-h-[44px] items-start gap-3"><input type="checkbox" name="legal_reviewed" defaultChecked={f.legal_reviewed || shown.legalReviewed} className="mt-1.5 h-5 w-5" /><span><span className="font-bold">A Nigerian lawyer has reviewed the Terms, Privacy and Refunds pages.</span><span className="block text-[14px] text-muted">Until this is ticked, those pages carry a “draft for legal review” notice. Tick it only once it is true.</span></span></label>
        </div>
        <button className="btn-primary self-start">Save business details</button>
      </form>
      <div className="card grid gap-1 p-5 text-[15px]">
        <p className="font-bold">What customers will see</p>
        <p className="text-muted">WhatsApp: {shown.whatsapp ? `+${shown.whatsapp}` : 'not shown'} · Phone: {shown.phone ?? 'not shown'} · Email: {shown.email ?? 'not shown'}</p>
        <p className="text-muted">Address: {shown.address ?? 'not shown'}</p>
        <p className="text-muted">“A person answers, {shown.hours}. We reply within {shown.replyWithin}.”</p>
      </div>
    </div>
  );
}
