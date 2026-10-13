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

1. **Sign up.** Go to `/signin`. Use Google, an email, or the quiet "phone number" link. Then fill in your name and WhatsApp number.
2. **Order.** Pick a product, choose your area, upload a PNG or JPG, approve the preview, check out, and press "Simulate a successful payment".
3. **Track it.** The tracker page shows the seven stages and the Brandit Promise.
4. **Run it from the team side.** Open `/console/login`. Demo logins are `admin@brandit.test`, `lead@brandit.test`, `files@brandit.test`, `support@brandit.test`, `dispatch@brandit.test` and `press@brandit.test`, all with PIN `1234`.

## What is built

| Area | What is there |
| --- | --- |
| Sign-up and sign-in | Google, email code, phone code. One account per person. A short details step asks only for what is missing. |
| Custom orders | Every product page and a "Need something different?" page take a request with photos. A person sends a price and a time; the customer accepts and pays; it becomes a normal job. Customers see their requests and quotes in their account. |
| Product manager | Console, **Products**: add a product, change its words, photos, options (with extra prices), quantity steps and sizes, and the 24-hour limits. A product goes on sale only when it is ready. No developer needed. |
| Coupon codes | Console, **Coupons**: percent off, naira off or free delivery, with dates, limits, a minimum spend, per-customer limits and product limits. Customers apply a code at checkout or from a link (`?code=CODE` on any page). |
| Ordering | Nine products, three pricing modes (quantity steps, per square foot, per size), live price, 24-hour promise with a countdown, a banner-to-scale diagram, a frame preview, shareable quotes. |
| Artwork | Upload with an automatic check (sharpness, shape, size), a proof the customer approves, or "Design it for me" with a brief. |
| Checkout | Pre-filled for signed-in customers, guest checkout still works, Paystack payment (card, transfer, USSD), VAT receipt. |
| After payment | Seven-stage job pipeline, tracker page, WhatsApp and SMS messages, finished-job photo, delivery code. |
| The Promise | Late 24-hour orders refund their delivery fee automatically. Problem reports go to a Promise desk with reprint and refund. |
| Team console | Job queue by time left, file desk, proofs, QR scan tickets, dispatch, orders, prices and rules (no developer needed), reports, **Team** (add staff, roles, PINs, printing partners) and **Setup** (what is configured and what is missing). |
| Customer privacy | Download my data and delete my account, with deletion blocked while an order is in progress. |
| Receipts | Email receipt after payment, with tracking and invoice links. |
| Business accounts | Same-again reorders, pro-forma and VAT invoices, plain-pack delivery. |
| Phone-first storefront | Two products per row on a phone, product search and category chips, "continue your order" bar, photo galleries, a Menu button in the console, and a home page built from the live catalogue. |
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
| English and Pidgin | English is the default. A switch lets a customer read the main ordering pages and receive WhatsApp messages in Pidgin. Staff can switch it off for everyone (console, **Growth**). |

## How sign-in works

- **Google** is the primary button. **Email** sends a six-digit code. **Phone** is the quiet third option and texts a code. No passwords.
- One person is one account. A correct code proves control of an email or number. Google is trusted only when it says the email is verified.
- A number someone only typed in (their WhatsApp number) is never used to find an account, so nobody can take over an account by typing someone else's number.
- An email already linked to a different Google account is refused rather than silently re-linked.
- A guest who ordered with an email gets that history when they later sign in with the same email.
- After sign-in, anyone missing a name or a reachable number goes to `/welcome`. Nobody else sees it.

## Going live

**Start with [DEPLOY.md](DEPLOY.md).** The recommended path is Render for the app and database, Cloudflare R2 for artwork files and Cloudflare in front (about $45 to $50 a month). `render.yaml` sets up the Render side. DEPLOY.md also covers a cheaper one-server Docker setup, the accounts you need, a before-launch checklist, backups and monitoring. The short version is below.

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

**Hosting.** Render in the Frankfurt region, with R2 for files and Cloudflare for your domain, is the tested recommendation: see DEPLOY.md, Path A. Any Node host works, but Vercel does not suit this version: uploads pass through the app and Vercel caps request bodies at about 4.5 MB. Behind Cloudflare's free plan a single upload cannot exceed 100 MB, so the upload limit defaults to 90 MB. The five-minute late-order check runs inside the server, so keep one instance.

## Project map

```
app/(site)/        customer website: home, products, templates, plan-event, season, custom order, order, checkout, track, account (with brand kit), help, faq, delivery, about, contact, business, legal
app/rider/         the private page a rider opens to start a trip and share a position
app/(auth)/        sign-in and details screens, with their own focused layout
app/(console)/     team console
app/api/           quotes, orders, uploads, payments webhook, Google sign-in, cron
components/        Logo, product art, price and promise cards, brand devices
lib/               price and promise engines, orders, jobs, claims, identity, sign-in codes, storage, coupons, referrals, nudges, templates, event plans, campaigns, rider, brand kit, review photos
content/           every customer message, in the brand voice (English and Pidgin), and the Pidgin dictionary for the screens
tests/             tests for every engine, account and payment rule
public/brand/      the approved logo, cut for the web (PNG, light and dark), plus the full-size master
public/sw.js       the service worker (production only); public/offline.html is the offline page
```

## Brand

- **Logo.** The approved Brandit logo: a bold "B" with a head and yellow speed lines, the wordmark with its yellow dot, and the tagline "Printing without the hassle." The files in `public/brand/` are cut from the approved master (`logo-original.png`); nothing is redrawn. The component is `components/Logo.tsx`: `full` (mark and wordmark side by side), `stacked` (as approved), `mark` and `wordmark`, each with a `tone="light"` version for dark backgrounds. If you receive a vector master (SVG or AI), send it to us: it would replace these PNGs and is sharper for large print.
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
```

## Known limits

- Google sign-in is tested against a faked Google response, not live Google. Try it once with real credentials before launch.
- Email, SMS, WhatsApp and Paystack are written against their public APIs but have not been run against live accounts.
- Uploads retry on a dropped connection but do not resume from the middle. PDFs are checked for page size but not previewed.
- Rate limiting is per server. Behind several servers, back it with a shared store.
- The 24-hour limits per product are starting assumptions. Time each product and set the real ones in the console.
- The rider link shares the position of the rider's phone only while the page is open. Browsers pause location sharing when the screen is locked, so a rider keeps the screen on. This is a convenience, not a guarantee, and the Terms say so.
- The Pidgin wording was written by Claude and has not been read by a native speaker. Have one read `content/pidgin-ui.ts` and the Pidgin part of `content/messages.ts` before you leave the switch on for everyone.
- The ready-made template previews are drawn by the app (style only). Replace them with your own designs in the console, Templates, if you like.
- Brandit Studio's picture-maker adapters (Recraft, FLUX, Google, OpenAI, fal/Topaz) were written from the vendors' published documentation and have not been run against live accounts. Run `npx tsx scripts/studio-bakeoff.ts --go --limit 8` and the console's **Test the connections** button with your keys before opening Studio. Model names and prices are settings, not code.
- Studio has no mockups (by decision). It also has no AI step that rewrites the customer's description: v1 passes a cleaned-up look sentence through a small Nigerian-wording lexicon.
- The demo drawing engine, the stand-in cut-out and the stand-in vector file exist only in demo mode, so the whole flow can be tried with no accounts. They are never used on a live site.
- Studio's fonts are open-licence (SIL OFL) and are shipped in `studio-assets/fonts`. Keep that folder in the build (`render.yaml` and the Dockerfile copy it).
- The Studio legal copy (Terms, Privacy, Refunds, FAQ, `/legal/ai-designs`) is a draft for counsel review, like the rest of the legal pages.
