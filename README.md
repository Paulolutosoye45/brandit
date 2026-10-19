# Brandit

Online design and print for Lagos. Customers see their price and delivery time before they pay, upload a file that is checked in seconds, and track the job through to a rider at their door. The team runs everything from a console.

One Next.js app: customer website, team console, API and database.

## Try it in two minutes

```bash
npm install
cp .env.example .env.local     # demo mode is on by default
npm run dev                    # http://localhost:3000
```

Demo mode needs no accounts or keys. Sign-in codes and a stand-in Google account chooser appear on screen, payment is simulated, and a local Postgres (PGlite) holds the data.

Things to try:

1. **Order.** On the home page tap a product (or **Order now**). The Order Builder opens on top of the page: choose a package or your own options, upload a PNG or JPG, tap **Looks right, continue**, sign in with an email code (the demo shows the code on screen) or the stand-in Google chooser, check your address, tap **Pay now**, and press "Simulate a successful payment". That is five taps for a new customer, four once signed in, and two for **Same again** from your account.
2. **Order two things at once.** In the Order Builder tap **Looks right, add another**, pick a second product, and check out once. One basket, one delivery fee, one payment, one tracker.
3. **Track it.** The tracker page shows the seven stages and the Brandit Promise.
4. **Run it from the team side.** Open `/console/login`. Demo logins are `admin@brandit.test`, `lead@brandit.test`, `files@brandit.test`, `support@brandit.test`, `dispatch@brandit.test` and `press@brandit.test`, all with PIN `1234`.

## What is built

| Area | What is there |
| --- | --- |
| Sign-up and sign-in | Google or an email code, asked for in the middle of checkout so nobody is sent away. One account per person. Phone-code sign-in is built but hidden. |
| Custom orders | Every product page and a "Need something different?" page take a request with photos. A person sends a price and a time; the customer accepts and pays; it becomes a normal job. Customers see their requests and quotes in their account. |
| Product manager | Console, **Products**: add a product, change its words, photos, options (with extra prices), quantity steps and sizes, and the 24-hour limits. A product goes on sale only when it is ready. No developer needed. |
| Prices, options and packages | Console, **Products**, **Prices** on each product: a price grid that works like a spreadsheet (paste from Excel, bulk change, an optional cost on every price with a warning when a price is below cost), **Preview as a customer**, and **Who changed what**. **Options** sets what customers choose (pick one, tick any, or a count per size) with a fixed, per-piece, per-square-foot, per-position, percentage or per-quantity price on each choice, rules that stop impossible combinations, whether a customer may type a quantity between your steps, and one-tap **Packages** (Standard, Premium, Luxury). Tees and Totes is one section where the customer picks a tee or a tote first. **Price sheet (Excel)** downloads every price and cost on one sheet; upload it back, see what would change, then save (all or nothing). **Test every price** prices every combination a customer could build and checks the answers hang together. Changes show on the site the moment you save; placed orders keep their price. A choice or table with no price you have confirmed is hidden from customers on a live site; example prices exist only in demo mode and on the private test site (`APP_ENV=staging`). |
| Coupon codes | Console, **Coupons**: percent off, naira off or free delivery, with dates, limits, a minimum spend, per-customer limits and product limits. Customers apply a code at checkout or from a link (`?code=CODE` on any page). |
| Order Builder | One screen builds a line of an order for any product: package or options, quantity, area, deadline and artwork (upload and check, pick from the brand kit or a template, or design it for me). It runs as a full page (`/products/<slug>`) and as a panel that opens on top of any page from the home page tiles, the **Order now** button or the phone bar. The price and arrival time are always on screen and the server re-prices every line when it saves. Short links such as `/order/business-cards?package=standard&q=250` open it with those choices. |
| Basket | Several products in one order, up to 12 lines. Each line keeps its own file, proof and price. Delivery is charged once, the arrival time is the slowest line, there is one payment and one tracker, and the job queue shows a row per line. The basket lives in a cookie for 30 days, follows the customer when they sign in, and is the customer's latest open order on any device. |
| Ordering | Nine products, three pricing modes (quantity steps, per square foot, per size), live price, 24-hour promise with a countdown, a banner-to-scale diagram, a frame preview, shareable quotes. |
| Artwork | Upload with an automatic check (sharpness, shape, size), a proof the customer approves, or "Design it for me" with a brief. |
| Checkout | Sign in (Google or email code) right on the checkout page, then name, number, address and pay. Pre-filled from the last order. Paystack payment (card, transfer, USSD), VAT receipt. Guest checkout exists only as a fallback when no sign-in method is configured. |
| After payment | Seven-stage job pipeline, tracker page, WhatsApp and SMS messages, finished-job photo, delivery code. |
| The Promise | Late 24-hour orders refund their delivery fee automatically. Problem reports go to a Promise desk with reprint and refund. |
| Team console | Job queue by time left, file desk, proofs, QR scan tickets, dispatch, orders, prices and rules (no developer needed), reports, **Team** (add staff, roles, PINs, printing partners) and **Setup** (what is configured and what is missing). |
| Customer privacy | Download my data and delete my account, with deletion blocked while an order is in progress. |
| Receipts | Email receipt after payment, with tracking and invoice links. |
| Business accounts | Same-again reorders, pro-forma and VAT invoices, plain-pack delivery. |
| Phone-first storefront | A bottom bar with Home, Order, Basket (with a count) and Account; a home page with a search and six product tiles that open the builder in place; two products per row, category chips, photo galleries, a Menu button in the console, and a home page built from the live catalogue. |
| Pages | Home, Products, Templates, Plan my event, Seasonal pages, Custom order, For businesses, Delivery and pickup, FAQ, Help, About, Contact, Terms and Conditions (23 sections), Reprints and Refunds, Privacy Policy. They read the live settings (VAT, claim window, price-hold time), so the text always matches how the app behaves. |
| Reviews | Customers can agree to have their review shown; staff pick which ones appear on the home page (console, **Reviews**). |
| Photo reviews | A customer can add a photo of the finished job. Every photo is re-saved by us (location and camera details removed), stays private until a person at Brandit approves it, and is public only if the customer also agreed, the review is featured, and it is approved. Rejected photos are deleted at once; unchecked photos are deleted after 60 days. |
| Unpaid-order reminder | One friendly WhatsApp or SMS reminder, with a link back to payment, for an order that was filled in but not paid. Never at night, once per order, never twice a day, off for anyone who opts out. Console, **Growth**. |
| Referral codes | Every customer has a personal code. A friend takes a percentage off their first order; when that order is delivered the sharer earns a reward code. Built on the coupon engine, with caps and an account page showing codes and rewards. Console, **Growth**. |
| Ready-made templates | Church programme, funeral programme, wedding invitation, school flyer, menu card, event banner, party poster, T-shirts, shop-opening flyer, roll-up banner. The customer answers a few questions and gets a price and a design order with the wording written out for the designer. Console, **Templates**: add, edit, preview, switch on or off. |
| Plan my event | One form for a wedding, birthday, funeral, church, company, school or shop-opening event: date, guests, suggested items (the customer changes quantities). A person sends one quote; one payment; delivered together, aiming two days before the event. |
| Seasonal pages | Wedding season, December events, back to school: dated landing pages with products, templates, an optional coupon and an order-in-time note. They go live and end on their own dates. Console, **Seasonal pages**. |
| Delivery window and rider link | Morning (9am to 1pm) or afternoon (1pm to 5pm) as a plan for the rider; 24-hour orders are always afternoon. The rider opens a private link, starts the trip and shares a position only until delivery; the customer sees a map link and a "close by" message. Delivery code can be entered on the rider page. |
| Brand kit | Business and regular accounts keep a logo, colours and up to 20 files, and reuse them on new orders. Included in the data download and deleted with the account. |
| Install on the phone | A gentle "Add to home screen" message (Android prompt, iPhone instructions), snoozed for 30 days, plus a friendly offline page. The service worker never stores orders, tracking pages or the console. |
| Brandit Studio | AI designs for print, without mockups. The customer types the words, sees free sketches, then pays for a Standard or Premium design. The picture maker draws only the background art; Brandit sets every word in real fonts from the customer's exact text, so spelling is never at risk, and customer photos are never sent to a vendor. A print-readiness gate (size, dpi, safe margin, spelling tick) must pass before a design can be ordered, and the approved file is locked with a fingerprint. Tiers, packs, extra rounds, vector file, a designer check, print-order credit, automatic refunds, content rules, daily spend caps and a margin report are all in the console, **Studio**. Closed on a live site until a picture-maker key is set. |
| Studio inside the order | Brandit Studio is one more way to settle a product's artwork in the Order Builder and the basket, so a customer can mix a Studio design, an uploaded file and a "design it for me" line in one order and one payment. Designs they have made are under **My designs** in their account. |
| Pay link | "Ask someone else to pay": the customer fills in the order as normal, then shares a link. The person who opens it sees what is being bought, the price and the delivery time (never the address or phone number), gives a name and an email, and pays. The receipt and the console say who paid. |
| Staff-built orders | Console, **New order**: a team member turns a WhatsApp chat into a real order (products, delivery, file now or later), and sends the customer the pay link. The order starts the moment it is paid. |
| Lists of names | For ID cards, name tags and tees the customer pastes or types one name per piece; the count has to match the quantity before they can pay, and the file desk sees the list on the job. (Names only: no photos.) |
| Reminders | "Running low?" about 90 days after delivery, with a one-tap reorder, and an optional weekly reminder a customer sets on an order ("every Thursday morning"). Only inside 8am to 8pm Lagos time, one message at a time, a stop link in every message, and a switch in the customer's account and in console **Growth**. |
| Sample pack | A small box of real Brandit work, sold as an ordinary product with no artwork. What the customer pays comes back as a code for the same amount once the box is out for delivery. It starts switched off on a live site until you set its price (console, **Products**, Sample pack). |
| Company accounts | The first person to give a company name owns it. They invite the team with a link; members order under the company name, use the company brand kit, and see their own orders. The owner sees every company order and downloads a monthly statement (CSV). The account is handed over if the owner deletes theirs. |
| Print-ready fix | If a customer's picture would lose its edges when cut, "Add the extra edge for me" makes a print-ready copy and keeps the original untouched. Undo puts the original back. (JPG and PNG on cut-and-trim products; PDFs are checked by a person.) |
| Console (Phase 4) | **Today**, **Payments** (refunds with a reason, capped for a production lead, never more than what is left, never twice), **Customers** (search, filters, notes, spreadsheet), **Stock** (switch a colour, size or paper on or off), **Homepage** (headline, announcement bar, featured products, Founding counter), **FAQ and policies** (edit, see old versions, go back to the built-in text), **Business details** (WhatsApp number, address, hours: no developer or redeploy), **Messages** (every message, when it is sent, a test send), **Activity log** (who changed what), and a forgot-PIN email code. Each role sees only its own screens. |
| English and Pidgin | English is the default. A switch lets a customer read the main ordering pages and receive WhatsApp messages in Pidgin. Staff can switch it off for everyone (console, **Growth**). |

## How sign-in works

- **Google** is the primary button. **Email** sends a six-digit code. Phone-code sign-in still exists in the code but is hidden. No passwords.
- Browsing, prices, the Order Builder, uploading and checking a file, the basket and tracking an order from its link never ask for a sign-in. Paying does.
- One person is one account. A correct code proves control of an email or number. Google is trusted only when it says the email is verified.
- A number someone only typed in (their WhatsApp number) is never used to find an account, so nobody can take over an account by typing someone else's number.
- An email already linked to a different Google account is refused rather than silently re-linked.
- A guest who ordered with an email gets that history when they later sign in with the same email.
- Name and number are asked for on the checkout page itself. The separate welcome page is only shown from "Edit my details" in the account.

## Going live

**Already have a site running? Start with [GO-LIVE.md](GO-LIVE.md)**: one page, in order, no staging step. **Starting from nothing? Use [DEPLOY.md](DEPLOY.md).** The recommended path is Render for the app and database, Cloudflare R2 for artwork files and Cloudflare in front (about $45 to $50 a month). `render.yaml` sets up the Render side. DEPLOY.md also covers a cheaper one-server Docker setup, the accounts you need, a before-launch checklist, backups and monitoring. The short version is below.

Work through this in order.

1. **Database.** Create a Postgres database (Supabase works) and set `DATABASE_URL`. Tables are created on first start.
2. **Switch off demo mode.** Set `DEMO_MODE=false`, a long `SESSION_SECRET`, `CRON_SECRET`, and `ADMIN_EMAIL` and `ADMIN_PIN` for your first admin. Change the PIN after your first login.
3. **Google.** Create an OAuth client in Google Cloud and add `{your site}/api/auth/google/callback` as a redirect URI. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Until both are set, the Google button is hidden.
4. **Email codes.** Create a Resend account, verify your sending domain, set `RESEND_API_KEY` and `EMAIL_FROM`. Until then the email option is hidden.
5. **SMS codes.** Create a Termii account, register the `Brandit` sender ID, set `SMS_API_KEY`. Until then the phone option is hidden.
6. **Payments.** Set `PAYSTACK_SECRET_KEY` and add `{your site}/api/webhooks/paystack` as the webhook URL in Paystack.
7. **Files.** Either host on a server with a persistent disk, or set the `S3_*` values to use Cloudflare R2 or any S3 bucket.
8. **WhatsApp.** Set `NEXT_PUBLIC_WHATSAPP`. For automatic order messages, set up the WhatsApp Business Platform, submit the message templates listed in `WHATSAPP_TEMPLATES.md` (copy and paste; `npm run templates:whatsapp` rebuilds the list), then set the two `WHATSAPP_*` values.
9. **Prices and rules.** Prices and fees marked "placeholder" in the console were made up to demonstrate the system. Replace them with your real cost-based prices, then set delivery zones and fees, the daily 24-hour slot count and the cut-off time.
10. **Legal.** The Terms, Privacy and Refunds pages are drafts and say so on the page. Have a Nigerian lawyer review them, adjust the policy choices flagged in the review document, then set `LEGAL_REVIEWED=yes` to remove the draft notice.
11. **Contact details.** Optionally set `NEXT_PUBLIC_SUPPORT_EMAIL` and `NEXT_PUBLIC_BUSINESS_ADDRESS`. They appear on the Contact page and in the legal pages. Also enter your pickup address in the console under Delivery and rules.
12. **Photos.** Upload a real photo for each product in the console (Products, Edit, Photos). Photos are shrunk automatically with `sharp`, which installs with `npm install`.

**Hosting.** Render in the Frankfurt region, with R2 for files and Cloudflare for your domain, is the tested recommendation: see DEPLOY.md, Path A. Any Node host works. Vercel runs the site too (DEPLOY.md, Path D) but caps uploads at 4 MB, because uploads pass through the app and Vercel refuses request bodies over about 4.5 MB. Behind Cloudflare's free plan a single upload cannot exceed 100 MB, so the upload limit defaults to 90 MB. The five-minute late-order check runs inside the server, so keep one instance.

## Project map

```
app/(site)/        customer website: home, products, templates, plan-event, season, custom order, order, checkout, track, account (with brand kit), help, faq, delivery, about, contact, business, legal
app/rider/         the private page a rider opens to start a trip and share a position
app/(auth)/        sign-in and details screens, with their own focused layout
app/(console)/     team console
app/api/           quotes, orders, uploads, payments webhook, Google sign-in, cron
app/(site)/pay-link, reorder, reminders, join   the pay link, the reorder reminder page, the stop-reminders page and the company join page
components/        Logo, product art, price and promise cards, brand devices
components/builder the Order Builder (page and panel), the panel that opens over any page, the home quick order, the basket count
lib/               price and promise engines, orders, jobs, claims, identity, sign-in codes, storage, coupons, referrals, nudges, templates, event plans, campaigns, rider, brand kit, review photos
content/           every customer message, in the brand voice (English and Pidgin), and the Pidgin dictionary for the screens
tests/             tests for every engine, account and payment rule
public/brand/      the approved logo, cut for the web (PNG, light and dark), plus the full-size master
public/sw.js       the service worker (production only); public/offline.html is the offline page
```

## Brand

- **Logo.** The approved Brandit logo (October 2026): the "brandit" wordmark with speed lines and a yellow dot over the i, and the tagline "...Printing without the hassle". The files in `public/brand/` are cut from the approved masters (`logo-original.png`, and the all-white `logo-original-on-dark.png`); nothing is redrawn. The component is `components/Logo.tsx`: `full` (the wordmark with its speed lines), `stacked` (as approved, with the tagline), `mark` (the b with its speed lines) and `wordmark` (letters only), each with a `tone="light"` version for dark backgrounds. The app icons and favicon are cut from the mark; the share image uses the stacked logo. If you receive a vector master (SVG or AI), send it to us: it would replace these PNGs and is sharper for large print.
- **Colour.** Ink `#0B1F33`, signal yellow `#FFC400`, paper `#F3F5F7`. Yellow is used for primary actions, and always carries ink text.
- **Type.** Bricolage Grotesque for headlines and prices, DM Sans for everything else. Both are served from this site.
- **Motifs.** Crop marks around anything that is a proof, and halftone dots, because that is how print builds an image. Used sparingly.
- **Voice.** Fast, exact, calm, warm, honest. Prices and times first. Plain words before print words. No exclamation marks in system messages. Customer messages live in `content/messages.ts`.

## Commands

```bash
npm run dev        # develop
npm test
npm run typecheck
npm run build && npm start
npx tsx scripts/studio-bakeoff.ts              # plan the Studio engine bake-off (spends nothing); add --go to run it
BASE=http://localhost:3100 npx tsx scripts/e2e.ts   # drives a running server over HTTP
npm run smoke -- https://yourdomain.ng             # after every deploy; add --deep --cron-secret <CRON_SECRET> for storage, Paystack, backups
npm run shots -- https://staging.yourdomain.ng     # phone-width screenshots compared with the last good set (DEPLOY.md)
npm run price-test [-- <product>]                   # price everything a customer could pick and check it adds up (reads the database, changes nothing; exits 1 on a failure)
npm run backup                                     # take a database backup now (the site also does it every night)
npm run restore -- --list                          # see the backups; then  <name> --check  or  <name> --into "<database>" --yes
```

The browser checks (`scripts/e2e.ts`) also pass against a real PostgreSQL 16 server, not just the built-in test database: start the site with `DATABASE_URL=postgresql://... DATABASE_SSL=false DEMO_MODE=true NODE_ENV=test npx next start` on an empty database (demo mode is refused on a hosted database in production on purpose).

## Known limits

- The Order Builder prices on the screen as a preview. The server prices every line again when it saves, so the figure that is charged is always the server's.
- A guest basket and an older draft belonging to a customer who then signs in are not merged. The basket in the browser wins and the older draft stays in the account until it expires.
- A Studio design is paid as part of the order, but a Studio credit pack and the extras (vector file, designer check, extra rounds) are separate purchases.
- A basket does not yet carry an event kit or a custom quote. Custom quotes and Plan my event keep their own flows.
- `scripts/e2e.ts` and the phone script count clicks, not seconds. The three-minute test with real people has to be run on the staging site (see `docs/phase-2-staging-test.md`).

- Lists of names carry names only. There are no photos on ID cards from a list yet.
- The company monthly statement is made when the owner asks for it (account, My business). It is not emailed on the first of the month.
- The print-ready edge fix works on JPG and PNG for cut-and-trim products. A PDF is checked by a person at the file desk.
- The sample pack and the reminders send WhatsApp messages that Meta must approve first (`WHATSAPP_TEMPLATES.md`). Until then a message goes by SMS if SMS is set up, and otherwise is logged. The fixed wording of the "paid" message says a person checks the file, even for an order that is only a sample pack.
- Stock is on or off only. Brandit does not count shirts or sheets.
- Google sign-in is tested against a faked Google response, not live Google. Try it once with real credentials before launch.
- Email, SMS, WhatsApp and Paystack are written against their public APIs but have not been run against live accounts.
- Uploads retry on a dropped connection but do not resume from the middle. PDFs are checked for page size but not previewed.
- Rate limiting is per server. Behind several servers, back it with a shared store.
- The live site shows only the prices you have confirmed. Add-ons and quantity steps without a confirmed price are hidden, and a product with a single confirmed pack is sold as that fixed pack until you add a second step. Load your cost sheet through the price sheet in the console.
- The 24-hour limits per product are starting assumptions. Time each product and set the real ones in the console.
- The rider link shares the position of the rider's phone only while the page is open. Browsers pause location sharing when the screen is locked, so a rider keeps the screen on. This is a convenience, not a guarantee, and the Terms say so.
- The Pidgin wording was written by Claude and has not been read by a native speaker. Have one read `content/pidgin-ui.ts` and the Pidgin part of `content/messages.ts` before you leave the switch on for everyone.
- The ready-made template previews are drawn by the app (style only). Replace them with your own designs in the console, Templates, if you like.
- Brandit Studio's picture-maker adapters (Recraft, FLUX, Google, OpenAI, fal/Topaz) were written from the vendors' published documentation and have not been run against live accounts. Run `npx tsx scripts/studio-bakeoff.ts --go --limit 8` and the console's **Test the connections** button with your keys before opening Studio. Model names and prices are settings, not code.
- Studio has no mockups (by decision). It also has no AI step that rewrites the customer's description: v1 passes a cleaned-up look sentence through a small Nigerian-wording lexicon.
- The demo drawing engine, the stand-in cut-out and the stand-in vector file exist only in demo mode, so the whole flow can be tried with no accounts. They are never used on a live site.
- Studio's fonts are open-licence (SIL OFL) and are shipped in `studio-assets/fonts`. Keep that folder in the build (`render.yaml` and the Dockerfile copy it).
- The Studio legal copy (Terms, Privacy, Refunds, FAQ, `/legal/ai-designs`) is a draft for counsel review, like the rest of the legal pages.
