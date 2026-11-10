# Brandit on Supabase Free: go live

This is the whole move, in order. When you finish, Brandit's website still runs on Render, but its database lives on **Supabase's Free plan**, and the Render database (the $19 a month one) is gone.

## What you get

| | Before | After |
| --- | --- | --- |
| Website (Render, Frankfurt) | $25 a month | $25 a month, unchanged |
| Database | Render Postgres, $19 a month | Supabase Free, $0 |
| Artwork files and nightly backups (Cloudflare R2) | unchanged | unchanged |
| **Total** | about $44 a month | **about $25 a month** |

Supabase cannot run Brandit's website code (it has no place to run a Next.js site), so the website stays on Render. Only the database moves.

## Two things about the Free plan that you must know

1. **Supabase Free keeps no backups.** Your safety net is Brandit's own nightly backup into your R2 bucket (about 2am Lagos time, checked by reading it back). Keep it green: **Console, Setup, Backups** must say the last backup is recent. Press **Back up now** before any big change. Once a month, press **Test a restore**.
2. **A Free project is paused after about 7 days of low activity.** A shop that is open does more than enough: Render checks `/api/health` all day, the five-minute late-order check runs all day, and every visitor reads the database. Supabase also emails the project owner about a week before a pause, so make sure the email on your Supabase account is one you read. If the site ever says it cannot reach the database, open the Supabase dashboard, choose the project and press **Resume project** (Supabase says you can resume a paused project for up to a year).

Also: the Free plan is **500 MB**. Brandit's artwork lives in R2, not in the database, so this lasts a long time. **Console, Setup** shows the size in plain words and turns amber at 350 MB. When it does, or when you want Supabase's daily backups, upgrade the project to Pro ($25 a month) in Supabase. Nothing in Brandit changes when you do.

## Part 1. Make the Supabase project (10 minutes)

Supabase changes its dashboard now and then, so a button may be worded slightly differently from what is written here. The names below are the ones in Supabase's documentation.

1. Sign in at supabase.com and press **New project**.
2. Name it `brandit`. For the database password press **Generate a password** (or type one with **letters and numbers only**, 16 or more characters). Copy it into your password manager now: you cannot read it again later.
3. Region: **Central EU (Frankfurt)**. This is the nearest to Lagos that Supabase has, and it sits beside Render's Frankfurt. Pick it carefully: Supabase does not document a way to change a project's region afterwards.
4. Plan: **Free**. If the form offers **Enable Data API**, switch it **off**. Brandit never uses it. (If you miss it, do step 7 below.)
5. Create the project and wait about two minutes until it says it is ready.
6. Press **Connect** at the top. Choose **Session pooler**. Copy the address. It looks like this:

   `postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`

   Replace `[YOUR-PASSWORD]` **and its square brackets** with your password. Check three things in what you have: the host ends in `.pooler.supabase.com`, the port is `5432`, and the user is `postgres.` followed by letters (your project reference). Save this finished address in your password manager. It is your `DATABASE_URL`.

   Do **not** use "Direct connection" (Render cannot reach it: it is IPv6 only on the Free plan) and do **not** use port `6543` (Brandit's database locks need the session mode). If you paste either by mistake, Brandit says so in plain words, and for port 6543 it switches to 5432 by itself.
7. Switch the public API off, if you did not in step 4: **Project Settings, Data API**, turn **Enable Data API** off. (Brandit also locks every table by itself at every start, so a table is never open to the public key, but closing the door entirely is better.)

## Part 2. Put the new code on Render

You can do this one of two ways. Pick the one that matches your site today.

### If the site is brand new, or you do not need to keep anything from the old database

1. Put this folder in your Git repository, replacing the old files, and push. (Or upload the project the way you did before.)
2. In Render open the web service, **Environment**. Set:
   - `DATABASE_URL`: the finished address from Part 1, step 6.
   - `DATABASE_POOL_MAX`: `5`.
   - Delete `DATABASE_SSL` if it is there (it was only for Render's private address).
   - Leave `S3_*`, `ADMIN_EMAIL`, `ADMIN_PIN`, `SESSION_SECRET`, `CRON_SECRET` and every other setting as they are. If this is a first deploy from `render.yaml`, Render asks you for the values once; see `DEPLOY.md`, Path A, step 4.
3. Save. Render deploys. On its first start the site builds its own tables on Supabase, locks them, and loads the starting catalogue and your admin sign-in. Go to **Part 3**.

### If you want to keep everything that is on the old Render database (settings, prices, team, customers, orders)

Allow about 45 minutes. The shop shows a "back in a few minutes" page for about 10 of them.

1. **Deploy the new code first, still on the old database.** Put this folder in your Git repository and push. If Render asks you for a `DATABASE_URL` value while it syncs, paste the **old** Render database's Internal address (Render, `brandit-db`, Connect, Internal) for now. Wait for the deploy to finish and open `/api/health`: it should say `"ok":true`.
2. **Close the shop.** In Render, **Environment**, add `MAINTENANCE` with the value `on` and save. After the redeploy, customers see "Back in a few minutes" and the Paystack webhook answers "try again later", so Paystack keeps any payment news and sends it again once you are back. Your team can still sign in to the console.
3. **Take the last backup.** Console, **Setup**, **Back up now**. Wait for the green confirmation. Write down the number of orders shown in **Orders**.
4. **Copy it into Supabase** from your computer. You need Node.js 22 (nodejs.org) and this project folder, and one run of `npm ci` inside it. In PowerShell, inside the folder:

   ```
   $env:S3_ENDPOINT = "<same as in Render>"
   $env:S3_BUCKET = "<same as in Render>"
   $env:S3_ACCESS_KEY_ID = "<same as in Render>"
   $env:S3_SECRET_ACCESS_KEY = "<same as in Render>"
   npm run restore -- --list
   npm run restore -- backups/daily/<the newest date>.json.gz --check
   npm run restore -- backups/daily/<the newest date>.json.gz --into "<your Supabase address from Part 1>" --yes
   ```

   The second command proves the copy is whole. The third builds the tables on Supabase, loads every row in one all-or-nothing step, checks every link between the tables and that the money adds up, carries the order numbers on, and locks the tables. It prints "Done" with the number of rows. If it stops, nothing was changed on Supabase, and the old database is untouched.
5. **Check the numbers.** In Supabase open **SQL Editor** and run `select count(*) from orders;`. It must equal the number you wrote down in step 3.
6. **Switch over.** In Render, **Environment**: set `DATABASE_URL` to your Supabase address, set `DATABASE_POOL_MAX` to `5`, delete `DATABASE_SSL` if it is there, and **delete `MAINTENANCE`**. Save. Render deploys once, and the shop opens on Supabase.
7. **Ask Paystack to resend.** In the Paystack dashboard, **Transactions**: any payment made during the closed minutes with no order in Brandit yet can be resent from its page in Paystack (look for the option to resend the webhook). Paystack also retries by itself. Compare the day's successful payments against **Payments** in the console at the end of the day.

## Part 3. Check it (10 minutes)

1. Open `https://thebrandit.ng/api/health`. It must say `"ok":true,"db":"up"`.
2. Sign in to the console and open **Setup**. Look for these lines:
   - **Database**: "Hosted Postgres on Supabase, through its session pooler, answering in ... ms". Under about 100 ms is normal from Render Frankfurt; the line turns amber above 250 ms. If it says "Render's private address", `DATABASE_URL` still points to the old database: go back to Part 2.
   - **Tables closed to Supabase's public API**: "All N tables are locked". If it is red, restart the site (Render, your web service, **Manual Deploy**, **Deploy latest commit**) and check again.
   - **Database size on Supabase**: green.
   - **Backups**: press **Back up now**. It must turn green with today's date. This matters most on Supabase Free.
   - **Late-order check**: shows a time within the last 10 minutes.
3. Press **Test the connections** and **Send a test alert**. hello@ and sales@ should each get the test email.
4. Place one small order from your own phone, pay with your own card, find it in **Job queue**, then refund yourself from **Payments**. This is the one test that proves Paystack, files, email and the database work together.
5. Run `npm run smoke -- https://thebrandit.ng` from your computer if you have the project there. It should print all green.

## Part 4. Switch off the old database (after two weeks)

For two weeks keep the old Render database. It is your way back. Render keeps billing for it until you delete it.

1. After two weeks of normal orders, take one last backup: **Console, Setup, Back up now**.
2. In Render open `brandit-db`, **Settings, Delete Database**. That ends the $19 a month.

## If something goes wrong

The site tells you what is wrong, in plain words. Open `https://thebrandit.ng/api/health` and read the `problem` line. The common ones:

| What you see | What it means and what to do |
| --- | --- |
| A page that says the site is not set up yet, naming `DATABASE_URL` | The setting is missing or malformed. Read the sentence: it says which part (direct address, plain `postgres` user, `[YOUR-PASSWORD]` left in). Fix it in Render, Environment. |
| "Supabase refused the password" | Type the password without the square brackets. If you have lost it: Supabase, Project Settings, Database, **Reset database password**, then copy the address again. Use letters and numbers only. |
| "Supabase did not recognise the project or the user" | The user must be `postgres.` plus your project reference (copy it from Connect, Session pooler), or the project is paused: press **Resume project** in Supabase. |
| "Supabase's connection pool is full" | Set `DATABASE_POOL_MAX` to `3` in Render and let it redeploy. If it only appears for a minute during a deploy, ignore it: the old server stops and it clears. Brandit already asks again by itself a few times before it shows an error. |
| The site is slow everywhere (the Setup page shows many ms) | The Supabase project is probably not in Frankfurt. Make a new project in Central EU (Frankfurt), then repeat Part 2 (second way) with it. |
| The old site is needed back | Within the two weeks: set `MAINTENANCE` to `on`, take a backup from Supabase (**Back up now**), restore it into the old Render database (`npm run restore -- <file> --into "<Render External address>" --yes`; add your computer's IP in the database's Networking tab first), set `DATABASE_URL` back to the old Internal address, delete `MAINTENANCE`. Orders taken since the move come with the backup. |

## What was tested, and what was not

Tested before you got this: the whole Brandit test suite (unit tests and the 505-check end-to-end run) against a real PostgreSQL server set up the way Supabase is: a login that is not a superuser and that is named `postgres.<project>`, Supabase's public roles `anon` and `authenticated` present, SSL on, and the address pointing at a `...pooler.supabase.com` host on port 6543. That run covered a fresh install, a restore from a backup, the tables being locked, the 30-second query limit being set on every connection, a full connection pool being retried, the late-order check and its database lock, and the "back in a few minutes" page.

**Not tested: a real Supabase project.** Supabase's own pooler (Supavisor) was not available to test against, so its exact behaviour is taken from Supabase's documentation. That is why each likely first-deploy mistake has its own message, and why **Part 3** is not optional.

## For your developer: what changed in the code

Only what the move needs. Everything else is the Brandit 2.0 project you already have, with the team-alert and free WhatsApp patch included.

New files: `lib/rls.ts` (locks every table against Supabase's public API and takes the rights of Supabase's `anon` and `authenticated` roles away), `tests/supabase.test.ts` (32 tests), this guide.

Changed:
- `lib/envcheck.ts`: recognises Supabase addresses; switches pooler port 6543 to 5432; trims and unquotes a pasted address; forces SSL on Supabase; pool size (5 on Supabase's pooler); plain-words messages for a direct address on Render, the plain `postgres` user, a left-in `[YOUR-PASSWORD]`, an unknown tenant or paused project, a full pool, a wrong password; the maintenance switch and its page.
- `lib/db.ts`: on Supabase the 30-second query limit is a `SET` on each connection (not a start-up setting); a pooler "full" answer is retried up to three times; tables are locked at every start.
- `lib/setup.ts`: Setup page lines for the connection mode, locked tables and database size; no more Render-internal advice for a Supabase address.
- `middleware.ts`: `MAINTENANCE=on` (customers get a 503 page; health check, cron, console and files stay open).
- `scripts/restore.ts`: port 6543 switched to 5432, and tables locked right after a restore on Supabase.
- `app/api/health/route.ts`: the database-down message points at the Supabase dashboard when the database is Supabase.
- `render.yaml`: no database block; `DATABASE_URL` is asked for once (`sync: false`); `DATABASE_SSL` removed; `DATABASE_POOL_MAX=5`.
- `.env.example`, `README.md`, `DEPLOY.md`, `GO-LIVE.md`: pointers and the new settings (`DATABASE_RLS`, `MAINTENANCE`).
- `tests/render-blueprint.test.ts`, `tests/render-staging.test.ts`: updated for the blueprint without a database block.

No new packages, no database migration, no change to prices, orders, payments or the console.
