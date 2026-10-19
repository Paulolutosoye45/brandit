import { isDemo } from './db';
import { DEFAULT_SETTINGS } from './settings-defaults';
import { hashPin } from './password';
import type { Q } from './db';
import { seedTemplates } from './growth-content';
import { installCatalogue } from './catalogueInstall';

/*
 * Starting data. Products, options and price tables come from content/catalogue.ts (see lib/catalogueInstall.ts):
 * the real site gets only the prices the shop really has, and the demo also gets example prices marked as placeholders.
 * Delivery fees are placeholders until the real ones are entered in the console.
 */

const naira = (n: number) => n * 100;

const ZONES = [
  { name: 'Zone A: Mainland core', fee: 1500, eligible: true, areas: ['Yaba', 'Surulere', 'Ikeja', 'Maryland', 'Gbagada', 'Ilupeju', 'Ojuelegba', 'Anthony', 'Ogba', 'Magodo', 'Oshodi', 'Mushin'] },
  { name: 'Zone B: Island and Lekki', fee: 2500, eligible: true, areas: ['Victoria Island', 'Ikoyi', 'Lekki Phase 1', 'Oniru', 'Lagos Island', 'Ikate', 'Chevron', 'Banana Island'] },
  { name: 'Zone C: Outer Lagos', fee: 4000, eligible: false, areas: ['Ajah', 'Sangotedo', 'Ikorodu', 'Epe', 'Badagry', 'Festac', 'Ojo', 'Alimosho', 'Ikotun', 'Agege'] },
];

export async function seedIfEmpty(d: { query: Q['query']; tx: <T>(fn: (q: Q) => Promise<T>) => Promise<T> }) {
  const demo = isDemo();
  const have = await d.query<{ n: number }>('select count(*)::int as n from products');
  if (have[0].n > 0) return;

  await d.tx(async (q) => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await q.query('insert into settings (key, value) values ($1, $2) on conflict (key) do nothing', [key, JSON.stringify(value)]);
    }

    let sort = 0;
    for (const z of ZONES) {
      await q.query('insert into delivery_zones (name, areas, fee_kobo, eligible_24h, provisional, sort) values ($1,$2,$3,$4,true,$5)', [z.name, z.areas, naira(z.fee), z.eligible, sort++]);
    }

    const press = await q.query<{ id: string }>("insert into presses (name, is_partner) values ('Brandit hub', false) returning id");
    await q.query("insert into presses (name, is_partner) values ('Partner press (set up in console)', true)");
    const partner = await q.query<{ id: string }>("select id from presses where is_partner limit 1");

    // Staff. Demo mode gets one account per role with PIN 1234. Real mode gets only the admin from the environment.
    if (demo) {
      const demoStaff: [string, string, string, string | null][] = [
        ['admin@brandit.test', 'Ada (Admin)', 'admin', null],
        ['lead@brandit.test', 'Tunde (Production lead)', 'production_lead', null],
        ['files@brandit.test', 'Ngozi (File desk)', 'file_desk', null],
        ['support@brandit.test', 'Femi (Support)', 'support', null],
        ['dispatch@brandit.test', 'Sule (Dispatcher)', 'dispatcher', null],
        ['press@brandit.test', 'Partner press', 'partner_press', partner[0].id],
      ];
      for (const [email, name, role, pressId] of demoStaff) {
        await q.query('insert into staff (email, name, role, pin_hash, press_id) values ($1,$2,$3,$4,$5)', [email, name, role, hashPin('1234'), pressId]);
      }
    } else if (process.env.ADMIN_EMAIL && process.env.ADMIN_PIN) {
      await q.query("insert into staff (email, name, role, pin_hash) values ($1,'Admin','admin',$2)", [process.env.ADMIN_EMAIL.toLowerCase(), hashPin(process.env.ADMIN_PIN)]);
    }

    await installCatalogue(q, { examples: demo });
    void press;
    await seedTemplates(q);
  });
}
