import type { Metadata } from 'next';
import Link from 'next/link';
import { getCustomer } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { getBusiness } from '@/lib/business';
import { contactPhone } from '@/lib/identity';
import { formatLocal } from '@/lib/phoneFormat';
import { PageHead } from '@/components/Bits';
import { offeredItems } from '@/lib/eventPlan';
import { EVENT_TYPES, ITEMS, suggest, EVENT_BUFFER_DAYS, type EventType } from '@/lib/eventPlanCore';
import { lagosParts } from '@/lib/time';
import { PlanForm } from './PlanForm';
import { ViewBeacon } from '@/components/ViewBeacon';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Plan my event: invitations, programmes, banners and more',
  description: 'Tell us about your wedding, funeral, church or company event once. We send one price for everything you need printed, delivered before the day.',
};

const STEPS = [
  ['1', 'Tell us about the day', 'The kind of event, the date and how many guests.'],
  ['2', 'Tick what you need', 'We suggest quantities. Change anything.'],
  ['3', 'One price, one delivery', `A person sends one price for everything, and we aim to deliver ${EVENT_BUFFER_DAYS} days before the event.`],
];

export default async function PlanEvent(props: { searchParams: Promise<{ type?: string }> }) {
  const sp = await props.searchParams;
  const [offered, me, s] = await Promise.all([offeredItems(), getCustomer(), getSettings()]);
  const startType = (EVENT_TYPES.find((t) => t.key === sp.type)?.key ?? 'wedding') as EventType;
  const local = (p: string | null | undefined) => (p ? formatLocal(p) : '');
  const today = lagosParts(new Date()).ymd;
  return (
    <>
      <ViewBeacon name="plan_view" slug="plan-event" />
      <PageHead title="Plan my event" sub="Tell us about the day once. You get one price for everything that needs printing, delivered before the event." />
      <div className="mx-auto grid max-w-[1160px] items-start gap-8 px-5 pb-12 lg:grid-cols-[1fr_340px]">
        <PlanForm
          types={EVENT_TYPES.map((t) => ({ key: t.key, label: t.label, hint: t.hint }))}
          items={ITEMS.map((i) => { const o = offered.find((x) => x.key === i.key)!; return { key: i.key, label: o.label, hint: o.hint, unit: o.unit, priced: o.priced }; })}
          startType={startType}
          suggestions={Object.fromEntries(EVENT_TYPES.map((t) => [t.key, suggest(t.key, 100)]))}
          today={today}
          defaults={{ name: me?.name ?? '', phone: local(me ? contactPhone(me) : null), email: me?.email ?? '' }}
          replyHours={s.custom_reply_hours}
          whatsapp={(await getBusiness()).whatsapp}
        />
        <aside className="grid gap-4 lg:sticky lg:top-[84px]" aria-label="How it works">
          <ol className="card grid gap-4 p-5">
            {STEPS.map(([n, t, d]) => (
              <li key={n} className="flex gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent font-display font-extrabold">{n}</span>
                <span><span className="block font-bold">{t}</span><span className="block text-[15px] text-muted">{d}</span></span>
              </li>
            ))}
          </ol>
          <div className="card grid gap-1 p-5 text-[15px]">
            <p className="font-bold">No payment now</p>
            <p className="text-muted">You pay only if you accept the price. We reply within {s.custom_reply_hours} hours, Monday to Saturday.</p>
          </div>
          <p className="text-[14px] text-muted">Only need one thing? <Link href="/templates" className="link">Start from a template</Link> or <Link href="/products" className="link">see all products</Link>.</p>
        </aside>
      </div>
    </>
  );
}
