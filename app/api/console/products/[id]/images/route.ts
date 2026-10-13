import { NextResponse } from 'next/server';
import { getStaff } from '@/lib/session';
import { can } from '@/lib/permissions';
import { addProductImage } from '@/lib/productImages';
import { ProductError } from '@/lib/productAdmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Staff upload product photos here. It is a route, not a server action, because a phone photo is bigger than an action may carry. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const staff = await getStaff();
  if (!staff || !can(staff.role, 'manage_catalog')) return NextResponse.json({ ok: false, error: 'Sign in again to add photos.' }, { status: 403 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ ok: false, error: 'We could not find that product.' }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'The upload did not arrive in one piece. Try again on a steadier connection.' }, { status: 400 });
  }
  const files = form.getAll('photos').filter((f): f is File => typeof f !== 'string' && f.size > 0).slice(0, 8);
  if (!files.length) return NextResponse.json({ ok: false, error: 'Choose a photo first.' }, { status: 400 });

  let added = 0;
  const errors: string[] = [];
  for (const f of files) {
    try {
      await addProductImage(id, { name: f.name || 'photo', buf: Buffer.from(await f.arrayBuffer()) });
      added++;
    } catch (e) {
      errors.push(e instanceof ProductError ? e.message : `We could not save "${f.name}".`);
    }
  }
  return NextResponse.json({ ok: added > 0, added, errors }, { status: added > 0 || !errors.length ? 200 : 422 });
}
