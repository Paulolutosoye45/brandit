# Deploying Brandit

This guide takes Brandit from a folder of code to a live site taking real orders. Each step says what to do and how you will know it worked. A developer should do the technical steps; you should do the account steps with them.

## Choose where it runs

| Path | Good for | You look after |
| --- | --- | --- |
| **A. Render, with Cloudflare R2 for files and Cloudflare in front** (recommended, and what `render.yaml` sets up) | Someone else runs the server and database, with automatic backups. About $45 to $50 a month. | Almost nothing. |
| **B. One server with Docker Compose** | The cheapest option, about €6 to €7 a month (for example Hetzner). Everything on one small server with automatic HTTPS. | The server: updates and backups. |
| **C. Railway or Fly.io** | Same idea as Render. The `Dockerfile` is picked up automatically. Add a Postgres database and a volume for files. | Almost nothing. |
| **D. Vercel** | Works for browsing, sign-in, ordering, payment and the console, but with limits: uploads are capped at 4 MB (Vercel refuses requests over about 4.5 MB, and most print artwork is bigger), Studio's picture jobs can stall, and the free plan allows only a daily scheduled check. Good for trying the site; Render is better for real orders. | A database and a file bucket of your own. |

Prices are from vendor and comparison sites in August and September 2026. Check each pricing page before you pay.

## Path A: Render, R2 and Cloudflare

You will have: the site and the late-order check on one Render web service (Frankfurt), a Render Postgres database (Frankfurt; set `ipAllowList: []` in `render.yaml` to keep it private, see step 8), artwork files in a private Cloudflare R2 bucket, and Cloudflare handling your domain.

| Part | Plan | About a month |
| --- | --- | --- |
| Web service | 1 CPU, 2 GB (`1c-2g`) | $25 |
| Database | 0.5 CPU, 1 GB (`0.5c-1g`), 5 GB disk | $19, plus $1.50 for disk |
| Artwork files | Cloudflare R2: first 10 GB free, then $0.015 per GB | $0 to start |
| Domain protection and caching | Cloudflare free plan | $0 |

Render charges in dollars. Make sure you have a card that works for international payments before you start. A Render team workspace may add a per-person fee; a single-person workspace does not.

**1. Put the code in a private Git repository.** Create a private repository on GitHub and push this folder to it. Render deploys from Git.

**2. Make the R2 bucket.** In the Cloudflare dashboard open **R2 Object Storage** and create a bucket called `brandit-files`. Leave it private: the site serves files itself. (Cloudflare may ask for a card to switch R2 on, even though the first 10 GB are free.) Then create an API token: **R2, Manage API tokens, Create API token**, permission **Object Read & Write**, limited to the `brandit-files` bucket. Write down four things: the **Access Key ID**, the **Secret Access Key**, the bucket name, and your S3 endpoint, which looks like `https://<your account id>.r2.cloudflarestorage.com`.

**3. Check the blueprint (optional but quick).** With the [Render CLI](https://render.com/docs/cli) version 2.7 or later: `render blueprints validate render.yaml`. It should report no errors.

**4. Create the services.** In the Render dashboard choose **New, Blueprint**, connect your repository, and let Render read `render.yaml`. It asks once for these values:

| Value | What to enter |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://yourdomain.ng` if your domain is ready, otherwise the `onrender.com` address Render shows (change it later, see step 7) |
| `NEXT_PUBLIC_WHATSAPP` | Your business WhatsApp number with country code and no plus, such as `2348031234567` |
| `ADMIN_EMAIL`, `ADMIN_PIN` | Your sign-in for the team console. The PIN is 6 to 12 digits, not a run like `123456`. You will change it after the first login. |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | From step 2 |

Render makes `SESSION_SECRET` and `CRON_SECRET` itself, so there is nothing to type for them. Apply the Blueprint and wait. The first build takes several minutes.

**5. Check it is alive.** Open `https://<your service>.onrender.com/api/health`. You should see `{"ok":true,"db":"up","mode":"live"}`. In the service's **Logs** you should see a line starting `[brandit] LIVE`. Then open `/console/login`, sign in with the admin email and PIN, and open **Setup**. Everything marked "Fix before launch" is something customers will notice. Work down it. At the bottom of Setup, check **Your address** from your own phone on mobile data. Rate limits trust whatever address a visitor sends unless you tell the server how many proxies sit in front of it. Add `TRUSTED_PROXY_HOPS` in Render's Environment tab and raise it one step at a time (Render alone is usually 2, and 3 with Cloudflare's orange cloud on) until your real address shows. Team sign-in is locked per account either way.

**6. Switch on the other services.** In the Render service open **Environment** and add values as each account becomes ready (the table under "The accounts you need" lists them). After you add or change anything, Render redeploys.

**7. Use your own domain, with Cloudflare.**

1. In Render, open the web service, **Settings, Custom Domains**, and add `yourdomain.ng` and `www.yourdomain.ng`.
2. In Cloudflare, open the domain's **DNS**. Delete any `AAAA` records (Render does not support IPv6). Add two `CNAME` records, one for `@` and one for `www`, both pointing at your `<service>.onrender.com` address. Set **Proxy status** to **DNS only** (grey cloud) for now.
3. In Cloudflare open **SSL/TLS, Overview** and set the encryption mode to **Full**.
4. Wait until Render shows the certificates as issued. Then you may switch the two records to **Proxied** (orange cloud) to get Cloudflare's caching and protection.
5. Change `NEXT_PUBLIC_APP_URL` in Render to `https://yourdomain.ng`. This setting is built into the site, so Render has to redeploy for it to take effect. `NEXT_PUBLIC_WHATSAPP` works the same way.
6. Update the addresses you gave other services: the Google redirect `https://yourdomain.ng/api/auth/google/callback`, and the Paystack webhook `https://yourdomain.ng/api/webhooks/paystack`.

Behind Cloudflare's free plan, a single upload cannot be larger than 100 MB. Brandit's own limit is 90 MB so a maximum-size file still gets through. Do not raise it above 99.

**8. Backups and watching it.**

- Open the database in Render and look at **Recovery** to see which backups your plan keeps and for how long. Before launch, restore one into a new test database to prove it works.
- For a site on Render, the database should accept connections only from inside Render: set `ipAllowList: []` in `render.yaml` (this package ships it open, for Vercel; see Path D). To take a manual copy or run a query from your own computer, add your public IP address in the database's **Networking** section, use the **External** connection string, and remove the address afterwards. `./scripts/backup.sh` needs `DATABASE_URL` set to that external string.
- Point a free uptime monitor (UptimeRobot, Better Stack) at `https://yourdomain.ng/api/health`, with an alert that texts you if it stops answering. Check for the text `"ok":true`.
- In Render, turn on email or Slack notifications for failed deploys.

**9. If something goes wrong.**

| What you see | What to do |
| --- | --- |
| Deploy fails and the log says "Cannot start in live mode" | `SESSION_SECRET` or `DATABASE_URL` is missing. Check the Environment tab. |
| The log says the database refused the connection, mentioning a password or SSL | Check that `DATABASE_URL` is set from the database. If the message is about SSL, set `DATABASE_SSL` to `true`, or to `false` if it says SSL is not supported. |
| The site has no styling or images | The build command did not copy the `public` and `.next/static` folders. Make sure `render.yaml` still has the `cp -r` steps. |
| Uploads fail only after you turned the Cloudflare orange cloud on | Check the file is under 90 MB, and that the proxy limit has not been lowered in Cloudflare's Network settings. |
| A change to the site address or WhatsApp number does not show | Redeploy. Those two settings are built in when the site is built. |

## Path B: one server with Docker Compose

**1. Get a server.** Ubuntu 24.04, at least 2 GB of memory. Install Docker (`curl -fsSL https://get.docker.com | sh`).

**2. Point your domain at it.** In your domain's DNS, add an `A` record for `yourdomain.ng` and another for `www`, both set to the server's IP address.

**3. Copy the project and fill in the settings.**

```bash
cp .env.example .env
```

Open `.env` and set at least these:

```
DOMAIN=yourdomain.ng
NEXT_PUBLIC_APP_URL=https://yourdomain.ng
POSTGRES_PASSWORD=<a long random password>
SESSION_SECRET=<run: openssl rand -hex 32>
CRON_SECRET=<run: openssl rand -hex 32>
ADMIN_EMAIL=you@yourdomain.ng
ADMIN_PIN=<6 to 12 digits, not a run like 123456>
```

Leave the keys for Paystack, Google, email, SMS and WhatsApp for step 5. The site will start without them and tell you what is missing.

**4. Start it.**

```bash
docker compose up -d --build
docker compose logs -f app
```

You know it worked when the log shows a line starting `[brandit] LIVE` and `https://yourdomain.ng/api/health` answers `{"ok":true,"db":"up","mode":"live"}`. The first start takes a minute while the database is prepared and HTTPS is arranged.

**5. Open the console and work down the Setup page.** Go to `https://yourdomain.ng/console/login`, sign in with `ADMIN_EMAIL` and `ADMIN_PIN`, then open **Setup**. Everything marked "Fix before launch" stops customers from ordering or paying. Fix them in the order below, restarting with `docker compose up -d` after each change to `.env`.

## Path D: Vercel

Read the limits first. **Uploads are capped at 4 MB** on Vercel (the platform refuses any request over about 4.5 MB, and Brandit's customers upload print artwork that is often larger). **Brandit Studio's picture jobs can stall**, because Vercel pauses a server copy as soon as it has replied. **The free (Hobby) plan allows scheduled checks only once a day**, and Brandit's late-order check runs every five minutes. For a site taking real print orders, use Path A. Use Vercel to try the site, or for jobs with small files.

**1. A database Vercel can reach.** Vercel has no disk that keeps files, so the built-in database cannot run. You need a hosted Postgres.
- On Render, open the database and copy the **External Database URL**. Its host ends in `.render.com`. The **Internal** URL (a host like `dpg-abc123-a`) only works for services running inside Render and gives a 500 from Vercel. In the database's **Info** page, under **Networking**, allow connections from anywhere (`0.0.0.0/0`), because Vercel connects from changing addresses. If the database was made by the Render Blueprint, `render.yaml` sets this rule every time the Blueprint syncs: this package's `render.yaml` already allows it, but an older copy (with `ipAllowList: []`) locks Vercel out again, and the log then says the connection timed out.
- On Neon or Supabase, use the direct connection or the session-mode address, not a transaction pooler. Brandit uses database locks that a transaction pooler breaks.
- Put the database in Frankfurt to match `vercel.json` (`"regions": ["fra1"]`). If yours is elsewhere, change that region to the nearest Vercel region, or every page waits on a long trip to the database.

**2. A file bucket.** Cloudflare R2 (Path A, step 2). Without it artwork uploads fail on Vercel.

**3. Environment variables.** In Vercel, open the project, then Settings, then Environment Variables, and add these for Production. Do not upload a `.env` file.

| Name | Value |
| --- | --- |
| `DEMO_MODE` | `false` (never `true` next to a real database: the site refuses to start) |
| `NEXT_PUBLIC_APP_URL` | Your site address, such as `https://your-project.vercel.app` or your own domain |
| `SESSION_SECRET` | A long random string (`openssl rand -hex 32`) |
| `DATABASE_URL` | The External Database URL from step 1 (its host ends in `.render.com`). Do not add `DATABASE_SSL`: Brandit always uses SSL for Render's external address. With Vercel's Neon integration, the integration sets this for you, and Brandit picks its direct (unpooled) address by itself |
| `ADMIN_EMAIL`, `ADMIN_PIN` | Your team console sign-in. The PIN is 6 to 12 digits, not a run like `123456` |
| `CRON_SECRET` | Any long random string. Vercel sends it with the scheduled check |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | From step 2 |
| `NEXT_PUBLIC_WHATSAPP` | Your WhatsApp number, country code first, no plus |
| `PAYSTACK_SECRET_KEY` and the other keys | As in "The accounts you need" below |

Optional: `DATABASE_POOL_MAX` (connections each server copy may open; default 4 on Vercel).

**4. Redeploy.** A change to an environment variable reaches the site only on the next deploy: open Deployments, the three dots on the latest one, then Redeploy. Addresses that start with `NEXT_PUBLIC_` are built in, so they need a redeploy as well.

**5. Check it.** Open `https://your-site/api/health`. It should answer `{"ok":true,"db":"up","mode":"live"}`. If the database cannot be reached it answers `"db":"down"` with a `problem` that says, in plain words, what to fix. Then sign in at `/console/login` and work down the **Setup** page. On Vercel the Setup page also tells you about the upload cap and Studio.

**6. The five-minute check.** On the Pro plan nothing more is needed: `vercel.json` schedules it. On the free plan a schedule more frequent than daily makes the deploy fail with "Hobby accounts are limited to daily cron jobs". Delete the `crons` block from `vercel.json` and have a free pinger such as cron-job.org call `https://your-site/api/cron/sweep` every five minutes with the header `Authorization: Bearer <your CRON_SECRET>`.

**If the site shows an error**

| What you see | What to do |
| --- | --- |
| A page saying **"Brandit is not set up yet"** | A required setting is missing. The page lists which (names only). Add them in Environment Variables, then redeploy. |
| A plain **"500 Internal Server Error"** | Open `/api/health` first: if the database is the problem, it says what to do. Otherwise, in Vercel open the project, then **Logs**, search for `brandit`, reload the site and read the newest lines. |
| The "not set up yet" page or the log mentions Render's Internal Database URL, or `ENOTFOUND dpg-...` | Use the External one (step 1): its host ends in `.render.com`. |
| `/api/health` or the log says the database timed out or refused the connection | The URL saved in Vercel is not the External one, the database is not running, or it does not accept outside connections (Render: the database's Info page, Networking). To prove the database itself works, run the test in "Testing a database address" below from your own computer. |
| The log says `password authentication failed` | Copy `DATABASE_URL` again from the database page. |
| The log says `too many connections` | Set `DATABASE_POOL_MAX` to `2`, or use fewer database connections on your plan. |
| Uploads of big files are refused | Expected on Vercel: the limit is 4 MB. See the top of this section. |
| The deploy fails on the cron line | Free plan: see step 6. |

**Testing a database address.** From the project folder on your computer (after `npm install`), in PowerShell:

```
$env:DATABASE_URL = "your External Database URL"
node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});c.connect().then(()=>c.query('select now()')).then(r=>{console.log('WORKS. Database time:',r.rows[0].now);process.exit(0)}).catch(e=>{console.log('FAILED:',e.message);process.exit(1)})"
```

`WORKS` means the database and the address are fine, so the problem is the value saved in Vercel (or a missing redeploy). On macOS or Linux, write `export DATABASE_URL="..."` instead of the first line.

## The accounts you need (all paths)

| For | Where | Settings |
| --- | --- | --- |
| Taking payment | [Paystack](https://paystack.com): finish business verification, then Settings, API keys. Add `https://yourdomain.ng/api/webhooks/paystack` as the webhook URL. | `PAYSTACK_SECRET_KEY` |
| Google sign-in | Google Cloud Console, APIs and Services, Credentials, OAuth client ID (Web application). Authorised redirect URI: `https://yourdomain.ng/api/auth/google/callback`. | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Email codes and receipts | [Resend](https://resend.com): add and verify your domain. | `RESEND_API_KEY`, `EMAIL_FROM` |
| SMS codes and fallback messages | [Termii](https://termii.com): register the sender ID `Brandit` (this can take days, so start early). | `SMS_API_KEY` |
| WhatsApp order messages | Meta WhatsApp Business Platform: verify the business, submit the message templates in `content/messages.ts`. Takes days. Until then SMS covers it. | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` |
| The "talk to a person" button | Your business WhatsApp number, with country code and no plus. | `NEXT_PUBLIC_WHATSAPP` |
| Contact page and legal pages | A support email and a business address, if you want them shown. Optional. | `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_BUSINESS_ADDRESS` |
| Late-job alerts | Your production lead's number. | `ALERT_PHONE` |
| Brandit Studio (AI designs) | Optional. At least one picture maker, or Studio stays closed: [Recraft](https://www.recraft.ai) (sketches, Standard, cut-outs, vectors), [Black Forest Labs](https://docs.bfl.ai) (FLUX), [Google AI Studio](https://aistudio.google.com) (Gemini image), [OpenAI](https://platform.openai.com) (Premium fallback and the image-safety check), [fal.ai](https://fal.ai) (Topaz enlarger). Set a spending limit on every vendor account as well as in the console. | `RECRAFT_API_KEY`, `BFL_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `FAL_KEY` |

You can launch with Paystack, a database, and any one of Google, email or SMS. The others can follow.

## Before the first real customer

1. **Prices.** Console, Prices and rules. Replace every "placeholder" price and delivery fee with figures from your cost sheet. Check the cut-off time, the arrival time, the daily 24-hour slots and your holidays.
2. **Team.** Console, Team. Add the production lead, the file desk, support and the dispatcher, each with their own PIN. Then open "My PIN" and change the admin PIN.
3. **A real order.** Place a small order yourself and pay with a real card. Check that you receive the email receipt and the order messages, that the order appears in the Job queue as paid, and that you can take it through to delivered.
4. **A real refund.** Report a problem on that order and refund it from the Promise desk. Check the money returns.
5. **Every sign-in method** you switched on, on a real phone.
6. **Legal.** Have a Nigerian lawyer review `/legal/terms`, `/legal/refunds` and `/legal/privacy`. They carry a "Draft for legal review" notice. When the lawyer is done, set `LEGAL_REVIEWED=yes` and restart. The notice goes away.
6b. **Custom orders.** Submit the four new WhatsApp templates in `content/messages.ts` for approval (`brandit_custom_received`, `brandit_custom_quote_ready`, `brandit_custom_declined`, `brandit_custom_alert`). Until they are approved, SMS covers them. Send a test request yourself, quote it in the console under **Custom orders**, accept it, and pay.
6d. **Growth features.** Console, **Growth**: check the reminder wait (default two hours), the referral numbers (default 10% off for a friend up to ₦5,000, a ₦1,000 reward valid 90 days, 20 rewards per person) and the delivery-window and Pidgin switches. Open `WHATSAPP_TEMPLATES.md` and submit the new templates (`brandit_abandoned_nudge`, `brandit_referral_reward`, `brandit_rider_nearby`) with the rest. The Pidgin versions end in `_pcm` and are optional: if one is not approved, the English version is sent instead.
6e. **Templates and seasons.** The ten starting templates and three seasonal pages are switched on from the first start, so they are visible to customers. Console, **Templates**: read each one, set your real wording and look, and switch off any you do not want. Console, **Seasonal pages**: check the dates of the three starting pages (Wedding season, December events, Back to school), edit the wording, and attach a coupon if you want one. Their prices come from your product prices, so set real prices first (step 1).
6f. **Rider link.** Open a test delivery in the console, copy the rider link from the job page, open it on a phone, start the trip and allow location. The page needs HTTPS, which Cloudflare and Render give you. Check that the customer's tracker shows the map link, and that it disappears after delivery.
6g. **Photo reviews.** After a test delivery, leave a review with a photo, then approve it in Console, **Reviews**, tick "Show on home page", and check the home page. Reject a second one and check it is gone.
6h. **Pidgin.** Have a Pidgin speaker on your team read the wording (`content/pidgin-ui.ts` for screens, `content/messages.ts` for messages). Until then you can switch Pidgin off in Console, **Growth**.
6i. **Brandit Studio (AI designs).** Studio is closed to customers until a picture-maker key is set, and starts as "only people on the invite list". Do these in order:
   1. Add the vendor keys you want (table above) and restart. Put a monthly spending limit on each vendor account too.
   2. Run the bake-off on your own computer: `npx tsx scripts/studio-bakeoff.ts` (a plan, spends nothing), then `npx tsx scripts/studio-bakeoff.ts --go --limit 8` (about 2 dollars). Open `contact-sheet.html`, fill `scores.csv`, run `--summarise`. Put the engine with the best cost per usable design first in each chain (Console, **Studio**, **Settings**, Picture makers).
   3. Console, **Studio**: press **Test the connections**. Each vendor should say it answered. Fix any that do not (usually a wrong model name: change it in Settings, Picture makers, Model names).
   4. Check the prices, the print credit, the free sketches (2 per verified phone a week), the daily free-spend ceiling (₦20,000) and the monthly vendor cap (about 300 US dollars while you pilot). The overview page shows the margin at full use; it warns below the 40% floor.
   5. Add a few friends and staff to the invite list. Make a real design as each tier, pay with a real card, send the file to a printer and look at the print. Approve a design, order it, and check the job page in the console shows "Made with Brandit Studio" with the fingerprint.
   6. Check the human-check queue (Console, **Studio**, **Review**) with a Premium design: a designer approves it, or leaves a note, and the customer gets the message. Set the hours customers are told.
   7. Have a Nigerian lawyer read the Studio sections of the Terms, Privacy Policy and Refunds page, the FAQ and `/legal/ai-designs`. They are part of the same draft-for-review notice.
   8. Submit the seven new Studio WhatsApp templates in `WHATSAPP_TEMPLATES.md` (names start `brandit_studio_`). Until they are approved, SMS covers them.
   9. When the numbers look right, change **Who can use Studio** to Everyone. Watch the overview daily for the first fortnight.
   Studio fonts ship in `studio-assets/fonts`; `render.yaml` and the Dockerfile copy them into the build. If designs fail with a font error, that folder is missing from the deploy.
6c. **Coupons.** In the console under **Coupons**, make a test code, use it on a real small order, and check the discount on the invoice.
7. **Photos.** Product illustrations stand in for photos. Photograph real jobs and add them in the console under Products, Edit, Photos. They are shrunk automatically.

## Looking after it

- **Updating on Render.** Push your changes to the Git repository. Render builds and deploys by itself, and keeps serving the old version until the new one passes the health check. If a deploy goes wrong, Render's **Rollbacks** puts the previous version back.
- **Updating on a Docker server.** Copy the new code over the old, then `docker compose up -d --build`. The database updates itself on start.
- **Backups.** Render: see Path A, step 8. Docker server: run `./scripts/backup.sh` every night (`crontab -e`, then `0 2 * * * cd /path/to/brandit && ./scripts/backup.sh`) and copy the `backups/` folder somewhere off the server. A backup that lives only on the same server is not a backup.
- **Restoring on a Docker server.** `gunzip -c backups/brandit-db-<stamp>.sql.gz | docker compose exec -T db psql -U brandit brandit`
- **Is it up?** Point a free uptime monitor (UptimeRobot, Better Stack) at `https://yourdomain.ng/api/health` and have it text you.
- **Logs.** Render: the service's **Logs** tab. Docker server: `docker compose logs -f app`.
- **The five-minute check** runs inside the server and refunds late 24-hour orders by itself. In the same pass it sends the unpaid-order reminders, issues referral rewards, erases rider positions that are no longer needed, and deletes review photos nobody checked in 60 days. The Setup page shows when it last ran. If it says "has not run", restart the app and look at the logs. Keep one instance of the web service so the check does not run twice.
- **If the site is down.** Render: check the service's **Events** and **Logs**. Docker server: `docker compose ps` shows which part stopped, and `docker compose up -d` brings it back. Orders already paid are safe in the database.

## Settings reference

Every setting is explained in `.env.example`. Settings are read when the server starts, so restart after changing any of them.

## What has and has not been tested

Upgrading an existing site: four database migrations (`004_catalog_coupons_custom`, `005_review_consent`, `006_growth`, `007_studio`) run by themselves on first start. They only add tables, columns and starting content (ten templates, three seasonal pages) and keep all existing products, orders, reviews and customers. Unit tests run them on a database that already has data. **Back up the database first**, as always. On Render that is the database's **Backups** tab; on a Docker server run `./scripts/backup.sh`.

Tested: the production build starts from the same commands `render.yaml` uses (`node .next/standalone/server.js`) against a real PostgreSQL server in live mode. The health check, the database migrations, the first admin, the five-minute check's protection, the static files, the logo and the security headers all worked. The blueprint's settings are also locked by an automated test (region, plan names, a private database, no secrets in the file).

Vercel (Path D): the start-up checks were reproduced on a normal Node server with `VERCEL=1` and each failure was confirmed to produce the page or the log line described above. Brandit has **not** been deployed on Vercel itself: the database connection from Vercel, the 4 MB cap, the scheduled check and Studio on Vercel are untested there.

Not tested: `render.yaml` has not been run on a Render account, so run `render blueprints validate render.yaml` first and watch the first deploy's log. The Docker, Compose and Caddy files for Path B have not been run on a Docker host. Do a full dry run, with a real small order and a real refund, before pointing your real domain at it.

Brandit Studio: tested with the built-in demo engine (the whole flow: sketches, paying, drawing, changes, print files, the print-readiness gate, approval, ordering, credit, refunds, privacy export and erase, the sweep) and with mocked vendor replies. **Not tested:** the real vendor APIs (the adapters follow each vendor's published documentation), real Paystack payment for Studio references, the WhatsApp templates, and a real print of a Studio file. Do the checklist in step 6i before opening Studio to customers.
