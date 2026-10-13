import { NextResponse } from 'next/server';
import { getStaff } from '@/lib/session';
import { can } from '@/lib/permissions';
import { setTemplateImage, TemplateError } from '@/lib/templates';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Staff upload the preview picture of a template here (a route, because a phone photo is bigger than a server action may carry). */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const staff = await getStaff();
  if (!staff || !can(staff.role, 'manage_templates')) return NextResponse.json({ ok: false, error: 'Sign in again to add a picture.' }, { status: 403 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ ok: false, error: 'We could not find that template.' }, { status: 404 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'The upload did not arrive in one piece. Try again.' }, { status: 400 }); }
  const f = form.get('photo');
  if (!f || typeof f === 'string' || f.size === 0) return NextResponse.json({ ok: false, error: 'Choose a picture first.' }, { status: 400 });
  if (f.size > 8 * 1024 * 1024) return NextResponse.json({ ok: false, error: 'That picture is over 8 MB. Choose a smaller one.' }, { status: 413 });
  try {
    await setTemplateImage(id, { name: f.name || 'preview', buf: Buffer.from(await f.arrayBuffer()) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof TemplateError ? e.message : 'We could not save that picture.' }, { status: 422 });
  }
}
