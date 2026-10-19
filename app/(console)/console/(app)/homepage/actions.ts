'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { saveHome } from '@/lib/homeContent';
import { audit } from '@/lib/audit';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '');

export async function saveHomeAction(fd: FormData) {
  const staff = await requireStaff('manage_content');
  // Each product has a "show" box and a position number. Lowest position first; ties keep the order of the list.
  const picks = fd.getAll('show').map(String).map((slug) => ({ slug, pos: Number(s(fd, `pos_${slug}`)) || 99 }));
  const featured = picks.sort((a, b) => a.pos - b.pos).map((p) => p.slug);
  const r = await saveHome({
    headline: s(fd, 'headline'), subline: s(fd, 'subline'), announce_on: fd.get('announce_on') === 'on', announce_text: s(fd, 'announce_text'), announce_link: s(fd, 'announce_link'),
    featured, founding_on: fd.get('founding_on') === 'on', founding_limit: s(fd, 'founding_limit'), founding_perk: s(fd, 'founding_perk'),
  });
  if (!r.ok) redirect(`/console/homepage?e=${encodeURIComponent(r.error)}&field=${r.field ?? ''}`);
  await audit({ id: staff.id, name: staff.name }, { area: 'content', action: 'homepage', target: 'Homepage', summary: 'Changed the homepage', detail: { featured: r.value.featured, announce: r.value.announce.on, founding: r.value.founding.on } });
  revalidatePath('/', 'layout');
  redirect('/console/homepage?ok=Saved.+Open+the+homepage+to+see+it.');
}
