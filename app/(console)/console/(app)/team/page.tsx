import { requireStaff } from '@/lib/session';
import { listPresses, listStaff, ROLES } from '@/lib/team';
import { ROLE_LABEL } from '@/lib/types';
import { Notice } from '@/components/Bits';
import { addPressAction, addStaffAction, changeRoleAction, resetPinAction, toggleActiveAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Team' };

const WHAT: Record<string, string> = {
  admin: 'Everything, including the team and setup.',
  production_lead: 'Runs production: prices and rules, files, quality check, claims.',
  file_desk: 'Checks files and sends proofs.',
  support: 'Answers customers and sees contact details.',
  dispatcher: 'Books riders and confirms deliveries.',
  partner_press: 'A printing partner. Sees only their own jobs.',
};

export default async function Team(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  const me = await requireStaff('manage_team');
  const [staff, presses] = await Promise.all([listStaff(), listPresses()]);
  const pressOptions = presses.map((p) => <option key={p.id} value={p.id}>{p.name}</option>);

  return (
    <div className="grid max-w-[980px] gap-8">
      <div><h1 className="text-[34px]">Team</h1><p className="text-muted">Everyone who works in the console. Each person signs in at <span className="font-bold">/console/login</span> with their email and a PIN of their own.</p></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}

      <section className="card grid gap-5 p-5" aria-labelledby="add">
        <div><h2 id="add" className="text-[22px]">Add someone</h2><p className="mt-1 text-[14px] text-muted">Pick the smallest role that does their job. You can change it later.</p></div>
        <form action={addStaffAction} className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="n">Name</label><input id="n" name="name" className="field" autoComplete="off" required /></div>
          <div><label className="label" htmlFor="e">Email</label><input id="e" name="email" type="email" className="field" autoComplete="off" required /></div>
          <div>
            <label className="label" htmlFor="r">Role</label>
            <select id="r" name="role" className="field" defaultValue="file_desk">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
          </div>
          <div>
            <label className="label" htmlFor="pr">Printing partner <span className="font-normal">(partner press only)</span></label>
            <select id="pr" name="press" className="field" defaultValue=""><option value="">Not a partner</option>{pressOptions}</select>
          </div>
          <div>
            <label className="label" htmlFor="p">PIN</label>
            <input id="p" name="pin" inputMode="numeric" autoComplete="new-password" className="field tabular" placeholder="6 to 12 digits" required />
            <p className="mt-1.5 text-[13px] text-muted">Not a run like 123456, and not one repeated digit.</p>
          </div>
          <div className="flex items-end"><button className="btn-primary w-full sm:w-auto">Add to the team</button></div>
        </form>
        <details className="text-[14px] text-muted"><summary className="cursor-pointer font-bold text-ink">What each role can do</summary>
          <ul className="mt-2 grid gap-1">{ROLES.map((r) => <li key={r}><span className="font-bold text-ink">{ROLE_LABEL[r]}.</span> {WHAT[r]}</li>)}</ul>
        </details>
      </section>

      <section className="grid gap-4" aria-labelledby="who">
        <h2 id="who" className="text-[22px]">Your team ({staff.filter((x) => x.active).length} active)</h2>
        {staff.map((m) => (
          <article key={m.id} className={`card grid gap-4 p-5 ${m.active ? '' : 'opacity-70'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[19px] font-bold">{m.name}{m.id === me.id && <span className="pill ml-2 bg-placeholder align-middle text-ink">You</span>}</p>
                <p className="break-all text-[14px] text-muted">{m.email}{m.press_name ? `, ${m.press_name}` : ''}</p>
              </div>
              <span className={`pill ${m.active ? 'bg-good-tint text-good' : 'bg-placeholder text-ink'}`}>{m.active ? ROLE_LABEL[m.role] : 'Switched off'}</span>
            </div>
            {m.active && (
              <div className="grid gap-3 lg:grid-cols-2">
                <form action={changeRoleAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={m.id} />
                  <div className="min-w-[160px] flex-1"><label className="label" htmlFor={`r-${m.id}`}>Role</label><select id={`r-${m.id}`} name="role" defaultValue={m.role} className="field">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
                  <div className="min-w-[160px] flex-1"><label className="label" htmlFor={`p-${m.id}`}>Partner</label><select id={`p-${m.id}`} name="press" defaultValue={m.press_id ?? ''} className="field"><option value="">None</option>{pressOptions}</select></div>
                  <button className="btn-secondary btn-sm">Save role</button>
                </form>
                <form action={resetPinAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={m.id} />
                  <div className="min-w-[160px] flex-1"><label className="label" htmlFor={`pin-${m.id}`}>New PIN</label><input id={`pin-${m.id}`} name="pin" inputMode="numeric" autoComplete="new-password" className="field tabular" placeholder="6 to 12 digits" /></div>
                  <button className="btn-secondary btn-sm">Reset PIN</button>
                </form>
              </div>
            )}
            {m.id !== me.id && (
              <form action={toggleActiveAction}>
                <input type="hidden" name="id" value={m.id} /><input type="hidden" name="active" value={String(!m.active)} />
                <button className="btn-ghost btn-sm !min-h-[40px] px-2 text-[15px] underline">{m.active ? 'Switch off' : 'Switch back on'}</button>
              </form>
            )}
          </article>
        ))}
      </section>

      <section className="card grid gap-4 p-5" aria-labelledby="presses">
        <div><h2 id="presses" className="text-[22px]">Presses and partners</h2><p className="mt-1 text-[14px] text-muted">Jobs are assigned to a press. A partner press logs in to see only its own jobs.</p></div>
        <ul className="grid gap-1.5">{presses.map((p) => <li key={p.id} className="flex items-center gap-2"><span className="font-bold">{p.name}</span>{p.is_partner && <span className="pill bg-placeholder text-ink">Partner</span>}</li>)}</ul>
        <form action={addPressAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1"><label className="label" htmlFor="pn">Add a press or partner</label><input id="pn" name="name" className="field" autoComplete="off" required /></div>
          <label className="flex min-h-[48px] items-center gap-2"><input type="checkbox" name="partner" className="h-5 w-5 accent-[#0B1F33]" defaultChecked />An outside partner</label>
          <button className="btn-secondary btn-sm">Add</button>
        </form>
      </section>
    </div>
  );
}
