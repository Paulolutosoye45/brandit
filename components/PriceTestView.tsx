import type { PriceTestReport } from '@/lib/priceTest';

const TONE = {
  pass: { mark: '✓', cls: 'bg-good-tint text-good', word: 'Passed' },
  warn: { mark: '!', cls: 'bg-warn-tint text-warn', word: 'Look at this' },
  fail: { mark: '✗', cls: 'bg-bad-tint text-bad', word: 'Failed' },
  info: { mark: 'i', cls: 'bg-placeholder text-ink', word: 'For your information' },
} as const;

/** One product's price test: a headline and every check, with examples for anything that did not pass. */
export function PriceTestView({ report, open }: { report: PriceTestReport; open?: boolean }) {
  const bad = report.checks.filter((c) => c.status === 'fail' || c.status === 'warn');
  return (
    <details open={open ?? !report.ok} className="card p-4 sm:p-5">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3">
        <span className={`pill ${report.ok ? (report.warn ? 'bg-warn-tint text-warn' : 'bg-good-tint text-good') : 'bg-bad-tint text-bad'}`}>{report.ok ? (report.warn ? 'Passed, with things to look at' : 'Passed') : 'Failed'}</span>
        <span className="text-[19px] font-bold">{report.name}</span>
        <span className="text-[14px] text-muted">{report.scenarios.toLocaleString('en-US')} prices tried · {report.pass} passed · {report.warn} to look at · {report.fail} failed</span>
      </summary>
      <ul className="mt-3 grid gap-2">
        {report.checks.map((c) => {
          const t = TONE[c.status];
          return (
            <li key={c.id} className="rounded-sm2 border border-line p-3">
              <p className="flex flex-wrap items-baseline gap-2">
                <span aria-hidden className={`inline-grid h-6 w-6 shrink-0 place-items-center rounded-full text-[13px] font-bold ${t.cls}`}>{t.mark}</span>
                <span className="sr-only">{t.word}: </span>
                <span className="font-bold">{c.label}</span>
                {c.status !== 'pass' && <span className="text-[15px] text-muted">{c.detail}</span>}
              </p>
              {c.examples.length > 0 && <ul className="mt-1 list-disc pl-10 text-[14px] text-muted">{c.examples.map((e, i) => <li key={i}>{e}</li>)}</ul>}
            </li>
          );
        })}
      </ul>
      {bad.length === 0 && <p className="mt-2 text-[14px] text-muted">Nothing to fix.</p>}
    </details>
  );
}
