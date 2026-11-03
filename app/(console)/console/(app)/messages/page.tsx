import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { can } from '@/lib/permissions';
import { query } from '@/lib/db';
import { TEMPLATES } from '@/content/messages';
import { GROUPS, WHEN, preview } from '@/lib/messageCatalog';
import { whatsappName } from '@/lib/messageNames';
import { whatsappOn, smsOn } from '@/lib/messages';
import { emailOn } from '@/lib/email';
import { teamEmailsFrom } from '@/lib/teamAlerts';
import { describeWhen } from '@/lib/time';
import { Notice } from '@/components/Bits';
import { retryMessageAction, testMessageAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Messages' };

export default async function Messages(props: { searchParams: Promise<{ e?: string; ok?: string; show?: string }> }) {
  const sp = await props.searchParams;
  const staff = await requireStaff();
  if (!can(staff.role, 'manage_content') && !can(staff.role, 'see_setup')) await requireStaff('manage_content');
  const canTest = can(staff.role, 'manage_content');
  const failedOnly = sp.show === 'failed';
  const log = await query<{ id: number; template: string; to_phone: string | null; to_email: string | null; body: string; status: string; channel: string; error: string | null; created_at: string }>(
    `select id, template, to_phone, to_email, body, status, channel, error, created_at from messages ${failedOnly ? "where status = 'failed'" : ''} order by id desc limit 60`,
  );
  const mail = emailOn();
  return (
    <div className="grid max-w-[920px] grid-cols-1 gap-7">
      <div><h1 className="text-[34px]">Messages</h1><p className="text-muted">Every message Brandit sends, when it goes out and exactly what it says. Send one to your own phone to see it arrive.</p></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      {whatsappOn()
        ? <Notice tone="warn">The paid WhatsApp Business Platform is on, so every message goes through Meta and is charged{smsOn() ? ', with SMS as the back-up' : ''}. To stop paying, remove WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID and restart.</Notice>
        : mail
          ? <Notice tone="good">Customers with an email get each message by email at once{smsOn() ? ', and those without one get an SMS' : ''}. Messages that need a person on WhatsApp wait under <a className="underline" href="/console/whatsapp">WhatsApp to send</a>. No Meta fees.</Notice>
          : <Notice tone="warn">Email is not set up, so customers cannot be messaged by themselves{smsOn() ? ' (SMS is on)' : ''}. Every message waits under <a className="underline" href="/console/whatsapp">WhatsApp to send</a> for a person to send. Set RESEND_API_KEY and EMAIL_FROM in Connections.</Notice>}
      <Notice tone="neutral">Team alerts (a paid order, a custom request, a problem report, a late job) go by email to {teamEmailsFrom(undefined).join(', ')}, or the addresses typed in Business details. If one failed it shows below with a Try again button.</Notice>
      <Notice tone="neutral">The wording of each message below is fixed in the code. Paid WhatsApp would need Meta to approve every word; email and the free WhatsApp list do not. What you can do here is read each one and test it.</Notice>

      <section id="log" className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-[22px]">Recently sent</h2>
          <nav className="flex gap-2" aria-label="Filter"><Link href="/console/messages#log" className={`btn-sm inline-flex min-h-[44px] items-center rounded-full border-2 px-4 font-bold ${!failedOnly ? 'border-ink bg-ink text-white' : 'border-line-control'}`}>All</Link><Link href="/console/messages?show=failed#log" className={`btn-sm inline-flex min-h-[44px] items-center rounded-full border-2 px-4 font-bold ${failedOnly ? 'border-ink bg-ink text-white' : 'border-line-control'}`}>Failed</Link></nav>
        </div>
        {log.length === 0 ? <p className="text-muted">{failedOnly ? 'Nothing has failed. Good.' : 'No messages yet.'}</p> : (
          <ul className="card divide-y divide-line">
            {log.map((m) => (
              <li key={m.id} className="grid gap-1 px-4 py-3">
                <p className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted [overflow-wrap:anywhere]"><span>{m.template.replace(/_/g, ' ')} · {m.to_email ?? m.to_phone ?? 'no number'} · {m.channel === 'whatsapp_manual' ? 'WhatsApp (by a person)' : m.channel}</span><span className={m.status === 'failed' ? 'font-bold text-bad' : ''}>{m.status} · {describeWhen(new Date(m.created_at))}</span></p>
                <p className="text-[15px] [overflow-wrap:anywhere]">{m.body}</p>
                {m.error && <p className="text-[13px] text-bad">{m.error}</p>}
                {m.status === 'failed' && canTest && (m.to_phone || m.to_email) && <form action={retryMessageAction}><input type="hidden" name="id" value={m.id} /><button className="btn-secondary btn-sm">Try again</button></form>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {GROUPS.map((g) => (
        <section key={g.title} className="grid gap-3">
          <h2 className="text-[22px]">{g.title}</h2>
          {g.keys.map((key) => (
            <details key={key} id={`t-${key}`} className="card group p-0 open:border-ink">
              <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden"><span><span className="block font-bold capitalize">{key.replace(/_/g, ' ')}</span><span className="block text-[14px] text-muted">{WHEN[key]}</span></span><span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-paper2 text-[20px] leading-none group-open:rotate-45">+</span></summary>
              <div className="grid gap-3 border-t border-line px-5 py-4">
                <div><p className="label">English</p><p className="rounded-md2 bg-paper2 p-3 text-[15px]">{preview(key, 'en')}</p></div>
                {preview(key, 'pcm') !== preview(key, 'en') && <div><p className="label">Pidgin (for customers who chose it)</p><p className="rounded-md2 bg-paper2 p-3 text-[15px]">{preview(key, 'pcm')}</p></div>}
                <p className="text-[13px] text-muted">WhatsApp template name: <code>{whatsappName(key)}</code> · fills in: {TEMPLATES[key].vars.join(', ')}</p>
                {canTest && (
                  <form action={testMessageAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="template" value={key} />
                    <div className="grow sm:max-w-[260px]"><label className="label" htmlFor={`ph-${key}`}>Send a test to my phone</label><input id={`ph-${key}`} name="phone" inputMode="tel" placeholder="0803 123 4567" className="field" required /></div>
                    <button className="btn-secondary btn-sm">Send me a test</button>
                  </form>
                )}
              </div>
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}
