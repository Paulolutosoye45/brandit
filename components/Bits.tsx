import type { JobStatus } from '@/lib/jobs';

export function StatusPill({ status, label }: { status: JobStatus | 'good' | 'warn' | 'bad' | 'neutral'; label?: string }) {
  const map: Record<string, [string, string]> = {
    on_track: ['bg-good-tint text-good', 'On track'],
    good: ['bg-good-tint text-good', ''],
    at_risk: ['bg-warn-tint text-warn', 'At risk'],
    warn: ['bg-warn-tint text-warn', ''],
    late: ['bg-bad-tint text-bad', 'Late'],
    bad: ['bg-bad-tint text-bad', ''],
    waiting: ['bg-placeholder text-ink', 'Waiting on customer'],
    neutral: ['bg-placeholder text-ink', ''],
    unset: ['bg-placeholder text-ink', 'Time not set yet'],
  };
  const [cls, def] = map[status] ?? map.neutral;
  return <span className={`pill ${cls}`}>{label ?? def}</span>;
}

export function Check({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
  );
}

export function Notice({ tone = 'neutral', children }: { tone?: 'good' | 'warn' | 'bad' | 'neutral'; children: React.ReactNode }) {
  const cls = { good: 'bg-good-tint text-ink', warn: 'bg-warn-tint text-ink', bad: 'bg-bad-tint text-ink', neutral: 'bg-placeholder text-ink' }[tone];
  return <div role={tone === 'bad' ? 'alert' : undefined} className={`rounded-md2 px-4 py-3 text-[15px] ${cls}`}>{children}</div>;
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1160px] flex-wrap items-end justify-between gap-4 px-5 pb-8 pt-10">
      <div className="max-w-[640px]">
        <h1 className="text-[38px] leading-[1.02] sm:text-[52px]">{title}</h1>
        {sub && <p className="mt-2 text-[18px] text-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}
