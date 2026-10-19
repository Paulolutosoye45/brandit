import { runPriceTests, formatPriceTests } from '../lib/priceTestRun';

/*
 * Usage: npm run price-test [-- <product web name>] [--quiet]
 * Asks the site for the price of everything a customer could pick and checks the answers hang together.
 * Exits 1 when any product fails, so it can run before every release.
 * It reads the database named by DATABASE_URL (or the built-in demo database) and changes nothing.
 */
const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const slug = args.find((a) => !a.startsWith('--'));

runPriceTests(slug)
  .then((reports) => {
    if (!reports.length) { console.error(slug ? `No product called "${slug}".` : 'There are no products.'); process.exit(2); }
    console.log('\n' + formatPriceTests(reports, { quiet }) + '\n');
    process.exit(reports.every((r) => r.ok) ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(2); });
