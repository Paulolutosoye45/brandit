import { requireStaff } from '@/lib/session';
import { ROLE_LABEL } from '@/lib/types';
import { Notice } from '@/components/Bits';
import { changePinAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My PIN' };

export default async function Me(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  const me = await requireStaff();
  return (
    <div className="grid max-w-[520px] gap-6">
      <div><h1 className="text-[34px]">My PIN</h1><p className="text-muted">{me.name.split(' (')[0]}, {ROLE_LABEL[me.role]}. Your PIN is the lock on your console account. Change it if anyone else has seen it.</p></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      <form action={changePinAction} className="card grid gap-4 p-5">
        <div><label className="label" htmlFor="c">Current PIN</label><input id="c" name="current" type="password" inputMode="numeric" autoComplete="current-password" className="field tabular" required /></div>
        <div><label className="label" htmlFor="n">New PIN</label><input id="n" name="next" type="password" inputMode="numeric" autoComplete="new-password" className="field tabular" placeholder="6 to 12 digits" required /></div>
        <div><label className="label" htmlFor="a">New PIN again</label><input id="a" name="again" type="password" inputMode="numeric" autoComplete="new-password" className="field tabular" required /></div>
        <button className="btn-primary">Change my PIN</button>
      </form>
    </div>
  );
}
