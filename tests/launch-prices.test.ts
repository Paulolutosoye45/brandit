import { beforeAll, describe, expect, it } from 'vitest';

process.env.PGLITE_DIR = 'memory';
process.env.DEMO_MODE = 'true';
delete process.env.APP_ENV;
process.env.SESSION_SECRET = 'a-long-random-secret-for-the-launch-price-book-1234';

let launch: typeof import('../lib/launchPrices');
let db: typeof import('../lib/db');
let catalog: typeof import('../lib/catalog');

beforeAll(async () => {
  db = await import('../lib/db');
  launch = await import('../lib/launchPrices');
  catalog = await import('../lib/catalog');
  await db.ready();
});

describe('the launch price book', () => {
  it('fits the catalogue, so loading it is safe', async () => {
    const r = await launch.previewLaunchPrices();
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.readLines).toBeGreaterThan(400);
    expect(launch.launchBookLines()).toBe(r.readLines);
  });

  it('is not loaded until someone loads it, and it never loads itself in demo mode', async () => {
    expect(await launch.launchState()).toBeNull();
    expect(await launch.autoLoadLaunchPrices({ LAUNCH_PRICES: 'yes', DEMO_MODE: 'true' } as any)).toBeNull();
    expect(await launch.autoLoadLaunchPrices({ DEMO_MODE: 'false' } as any)).toBeNull(); // the switch is off
    expect(await launch.launchState()).toBeNull();
  });

  it('loads once, on a live site with the switch on, and then leaves the team\'s own prices alone', async () => {
    const msg = await launch.autoLoadLaunchPrices({ LAUNCH_PRICES: 'yes', DEMO_MODE: 'false' } as any);
    expect(msg).toMatch(/loaded \(\d+ lines\)/);
    const st = await launch.launchState();
    expect(st?.by).toBe('first start');
    // the team changes a price in the console...
    await db.query("update price_rules set price_kobo = 1234500 where id = (select id from price_rules where product_id = (select id from products where slug = 'business-cards') and quantity = 100 and not provisional order by id limit 1)");
    // ...and a restart does not put it back
    expect(await launch.autoLoadLaunchPrices({ LAUNCH_PRICES: 'yes', DEMO_MODE: 'false' } as any)).toBeNull();
    const row = await db.one<any>("select price_kobo from price_rules where price_kobo = 1234500 limit 1");
    expect(row).toBeTruthy();
  });

  it('puts business cards, the quantity rule and delivery on sale with the owner\'s own numbers', async () => {
    const p = await catalog.getProduct('business-cards');
    expect(p).toBeTruthy();
    const steps = await catalog.quantitySteps(p!.id);
    expect(steps).toEqual(expect.arrayContaining([100, 250, 500, 1000]));
    const q = await db.one<any>("select qty_max from products where slug = 'flyers'");
    expect(q.qty_max).toBeLessThanOrEqual(10000);
  });
});
