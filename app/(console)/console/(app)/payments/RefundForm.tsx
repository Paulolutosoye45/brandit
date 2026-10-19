import { REASONS } from '@/lib/paymentsAdmin';
import { refundAction } from './actions';

/** A refund, written out as a form: how much, why, and a short note. Nothing is sent until the button is pressed, and the button says how much. */
export function RefundForm({ paymentId, leftKobo, leftLabel, back }: { paymentId: string; leftKobo: number; leftLabel: string; back: string }) {
  return (
    <details className="group">
      <summary className="btn-secondary btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">Refund…</summary>
      <form action={refundAction} className="mt-3 grid gap-3 rounded-md2 border border-line bg-paper2 p-4 sm:min-w-[320px]">
        <input type="hidden" name="payment" value={paymentId} />
        <input type="hidden" name="return" value={back} />
        <div><label className="label" htmlFor={`amt-${paymentId}`}>Amount to refund (naira)</label><input id={`amt-${paymentId}`} name="amount" inputMode="decimal" defaultValue={(leftKobo / 100).toString()} className="field" required /><p className="mt-1 text-[13px] text-muted">Up to {leftLabel} is left on this payment.</p></div>
        <div><label className="label" htmlFor={`why-${paymentId}`}>Why</label><select id={`why-${paymentId}`} name="reason" className="field" required defaultValue="">{[<option key="" value="" disabled>Choose a reason</option>, ...REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)]}</select></div>
        <div><label className="label" htmlFor={`note-${paymentId}`}>Note (optional, except “something else”)</label><input id={`note-${paymentId}`} name="note" maxLength={200} className="field" /></div>
        <button className="btn-dark">Send the refund</button>
        <p className="text-[13px] text-muted">The customer is messaged. This cannot be undone.</p>
      </form>
    </details>
  );
}
