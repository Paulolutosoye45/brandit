import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { getSettings } from '@/lib/settings';
import { query } from '@/lib/db';
import { Notice } from '@/components/Bits';
import { STUDIO_GROUPS, toInput, type Field } from '@/lib/studio/settingsSchema';
import { addInviteAction, removeInviteAction, saveGroupAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Studio settings' };

function Input({ f, value }: { f: Field; value: string }) {
  const id = `f-${String(f.key)}`;
  const name = String(f.key);
  const help = f.help ? <p className="mt-1 text-[13px] text-muted">{f.help}</p> : null;
  if (f.kind === 'bool') return <div><label className="flex min-h-[44px] items-center gap-3"><input type="checkbox" id={id} name={name} defaultChecked={value === 'on'} className="h-5 w-5 accent-[#0B1F33]" /><span className="font-bold">{f.label}</span></label>{help}</div>;
  if (f.kind === 'select') return <div><label className="label" htmlFor={id}>{f.label}</label><select id={id} name={name} defaultValue={value} className="field">{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>{help}</div>;
  if (f.kind === 'json' || (f.kind === 'text' && f.multiline)) return <div className="sm:col-span-2"><label className="label" htmlFor={id}>{f.label}</label><textarea id={id} name={name} defaultValue={value} rows={f.kind === 'json' ? 4 : 4} className="field !py-3 font-mono text-[14px]" spellCheck={false} />{help}</div>;
  return <div><label className="label" htmlFor={id}>{f.label}</label><input id={id} name={name} defaultValue={value} className="field" inputMode={f.kind === 'naira' || f.kind === 'int' || f.kind === 'float' ? 'decimal' : undefined} />{help}</div>;
}

export default async function StudioSettings(props: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const sp = await props.searchParams;
  await requireStaff('manage_studio');
  const s = await getSettings();
  const invites = await query<{ identifier: string; note: string | null; created_at: string }>('select identifier, note, created_at from studio_invites order by created_at desc limit 300');
  return (
    <div className="grid max-w-[980px] gap-8">
      <div><Link href="/console/studio" className="text-[14px] text-muted underline">Brandit Studio</Link><h1 className="mt-1 text-[34px]">Studio settings</h1><p className="text-muted">Prices, what each tier includes, safety limits and the picture makers. Changes apply straight away. Each section saves on its own.</p></div>
      {sp.e && <Notice tone="bad">{sp.e}</Notice>}
      {sp.ok && <Notice tone="good">{sp.ok}</Notice>}
      {STUDIO_GROUPS.map((g) => (
        <section key={g.id} id={g.id} className="card grid scroll-mt-6 gap-4 p-5">
          <div><h2 className="text-[22px]">{g.title}</h2>{g.blurb && <p className="text-[15px] text-muted">{g.blurb}</p>}</div>
          <form action={saveGroupAction} className="grid gap-4">
            <input type="hidden" name="group" value={g.id} />
            <div className="grid gap-4 sm:grid-cols-2">{g.fields.map((f) => <Input key={String(f.key)} f={f} value={toInput(f, s)} />)}</div>
            <button className="btn-primary btn-sm w-fit">Save {g.title.toLowerCase()}</button>
          </form>
        </section>
      ))}
      <section id="invites" className="card grid scroll-mt-6 gap-4 p-5">
        <div><h2 className="text-[22px]">Invite list</h2><p className="text-[15px] text-muted">While Studio is “only people on the invite list”, only these phone numbers and emails can use it. Paste several, one per line.</p></div>
        <form action={addInviteAction} className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
          <div><label className="label" htmlFor="who">Phone numbers or emails</label><textarea id="who" name="who" rows={3} className="field !py-3" placeholder={'0803 123 4567\nada@example.com'} /></div>
          <div><label className="label" htmlFor="note">Note (optional)</label><input id="note" name="note" className="field" maxLength={80} placeholder="Church committee" /></div>
          <button className="btn-secondary btn-sm">Add</button>
        </form>
        <div className="card overflow-x-auto"><table className="w-full min-w-[420px] text-left text-[15px]"><tbody>
          {invites.length === 0 && <tr><td className="px-4 py-6 text-center text-muted">Nobody is invited yet.</td></tr>}
          {invites.map((i) => (
            <tr key={i.identifier} className="border-b border-line last:border-0"><td className="px-4 py-2 font-bold">{i.identifier}</td><td className="px-4 py-2 text-muted">{i.note}</td><td className="px-4 py-2 text-right"><form action={removeInviteAction}><input type="hidden" name="id" value={i.identifier} /><button className="link text-[14px]">Remove</button></form></td></tr>
          ))}
        </tbody></table></div>
      </section>
    </div>
  );
}
