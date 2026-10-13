import { CopyButton } from './CopyButton';
import { naira } from '@/lib/money';
import { shareText, type ReferralSummary } from '@/lib/referrals';

/** "Give a friend 10% off, get a code for yourself." Shown in the account and after a delivery. */
export function InviteCard({ r, compact = false }: { r: ReferralSummary; compact?: boolean }) {
  const text = shareText(r.code, r.percent);
  const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const usable = r.rewards.filter((x) => x.usable);
  return (
    <section className="card grid gap-4 p-5 sm:p-6" aria-labelledby="invite-h">
      <div>
        <h2 id="invite-h" className={compact ? 'text-[22px]' : 'text-[26px]'}>Give {r.percent}%, get {naira(r.rewardKobo)}</h2>
        <p className="mt-1 text-muted">Share your code. A friend takes {r.percent}% off their first order. When it is delivered, you get {naira(r.rewardKobo)} off your next one.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-md2 bg-paper2 px-4 py-3">
        <span className="font-mono text-[24px] font-bold tracking-wide" aria-label={`Your code is ${r.code.split('').join(' ')}`}>{r.code}</span>
        <CopyButton text={r.code} label="Copy code" />
      </div>
      <div className="flex flex-wrap gap-2.5">
        <a href={wa} className="btn-primary btn-sm" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
        <CopyButton text={text} label="Copy message" />
      </div>
      {!compact && (r.friendsOrdered > 0 || r.earned > 0) && (
        <dl className="grid grid-cols-3 gap-3 border-t border-line pt-4 text-center">
          <div><dd className="font-display text-[28px] font-extrabold leading-none tabular">{r.friendsOrdered}</dd><dt className="mt-1 text-[13px] text-muted">friends ordered</dt></div>
          <div><dd className="font-display text-[28px] font-extrabold leading-none tabular">{r.earned}</dd><dt className="mt-1 text-[13px] text-muted">rewards earned</dt></div>
          <div><dd className="font-display text-[28px] font-extrabold leading-none tabular">{naira(r.earnedKobo)}</dd><dt className="mt-1 text-[13px] text-muted">given to you</dt></div>
        </dl>
      )}
      {usable.length > 0 && (
        <div className="grid gap-2 border-t border-line pt-4">
          <p className="text-[15px] font-bold">Your reward codes</p>
          <ul className="grid gap-2">
            {usable.map((x) => (
              <li key={x.code} className="flex flex-wrap items-center justify-between gap-2 rounded-md2 bg-good-tint px-4 py-3">
                <span><span className="font-mono text-[18px] font-bold">{x.code}</span> <span className="text-[14px]">{naira(x.amountKobo)} off</span>{x.endsAt ? <span className="text-[13px] text-muted"> · use by {new Date(x.endsAt).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short' })}</span> : null}</span>
                <CopyButton text={x.code} label="Copy" />
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-muted">Type a reward code in the coupon box at checkout while you are signed in.</p>
        </div>
      )}
    </section>
  );
}
