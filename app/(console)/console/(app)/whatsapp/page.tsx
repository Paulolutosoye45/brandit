import { requireStaff } from '@/lib/session';
import { outboxList, waLink, type OutboxRow, OUTBOX_DAYS } from '@/lib/outbox';
import { describeWhen } from '@/lib/time';
import { Notice } from '@/components/Bits';
import { emailOn } from '@/lib/email';
import { whatsappOn } from '@/lib/messages';
import { SendButton } from './SendButton';
import { alreadySentAction, markOpenedAction, putBackAction, skipAction, skipOptionalAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'WhatsApp to send' };

const label = (t: string) => { const s = t.replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };

function Item({ m }: { m: OutboxRow }) {
  const href = waLink(m.to_phone, m.body);
  return (
    <li className="grid gap-2 px-4 py-4">
      <p className="flex flex-wrap items-center justify-between gap-2 text-[14px] text-muted [overflow-wrap:anywhere]">
        <span><span className="font-bold text-ink">{m.code ?? 'No order'}</span>{m.customer_name ? ` · ${m.customer_name}` : ''} · {m.to_phone ?? 'no number'}</span>
        <span>{label(m.template)} · {describeWhen(new Date(m.created_at))}</span>
      </p>
      <p className="rounded-md2 bg-paper2 p-3 text-[15px] [overflow-wrap:anywhere]">{m.body}</p>
      <div className="flex flex-wrap items-center gap-2">
        {href ? <SendButton id={m.id} href={href} mark={markOpenedAction} /> : <span className="text-[14px] text-bad">No usable phone number.</span>}
        <form action={alreadySentAction}><input type="hidden" name="id" value={m.id} /><button className="btn-secondary btn-sm">Already sent</button></form>
        <form action={skipAction}><input type="hidden" name="id" value={m.id} /><button className="btn-secondary btn-sm">Skip</button></form>
      </div>
    </li>
  );
}

export default async function WhatsAppToSend(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('see_contact');
  const { now, optional, recent } = await outboxList();
  return (
    <div className="grid max-w-[860px] grid-cols-1 gap-6">
      <div>
        <h1 className="text-[34px]">WhatsApp to send</h1>
        <p className="text-muted">Brandit does not pay Meta to send WhatsApp messages. These are the ones that need a person. Tap <strong>Send on WhatsApp</strong>: WhatsApp opens with the customer&apos;s number and the message already typed. Press send there. Customers who gave an email have already had it by email.</p>
      </div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      {whatsappOn() && <Notice tone="warn">The paid WhatsApp Business Platform keys are set, so messages are sent through Meta and charged. To use this free list instead, remove WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID and restart.</Notice>}
      {!emailOn() && <Notice tone="warn">Email is not set up, so customers only hear from you through this list. Set RESEND_API_KEY and EMAIL_FROM and most updates go out by themselves.</Notice>}

      <section aria-labelledby="send-now" className="grid gap-3">
        <h2 id="send-now" className="text-[22px]">Send these now {now.length > 0 && <span className="pill bg-warn-tint text-warn align-middle">{now.length}</span>}</h2>
        {now.length === 0 ? <p className="card p-5 text-muted">Nothing is waiting. New messages appear here when an order moves on.</p> : <ul className="card divide-y divide-line">{now.map((m) => <Item key={m.id} m={m} />)}</ul>}
      </section>

      {optional.length > 0 && (
        <section aria-labelledby="optional" className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 id="optional" className="text-[22px]">Optional: reminders and offers</h2><p className="text-[14px] text-muted">Good for sales if you have a quiet moment. Safe to skip. Anything unsent is dropped after {OUTBOX_DAYS} days.</p></div>
            <form action={skipOptionalAction}><button className="btn-secondary btn-sm">Skip all of these</button></form>
          </div>
          <ul className="card divide-y divide-line">{optional.map((m) => <Item key={m.id} m={m} />)}</ul>
        </section>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="recent" className="grid gap-3">
          <h2 id="recent" className="text-[22px]">Done recently</h2>
          <ul className="card divide-y divide-line">
            {recent.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[14px]">
                <span><span className="font-bold">{m.code ?? 'No order'}</span> · {label(m.template)} · {m.status === 'sent' ? 'sent' : 'skipped'}{m.handled_by ? ` by ${m.handled_by}` : ''} · {m.sent_at ? describeWhen(new Date(m.sent_at)) : ''}</span>
                <form action={putBackAction}><input type="hidden" name="id" value={m.id} /><button className="btn-secondary btn-sm">Put back</button></form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
