# Going live with Brandit 2.0

This is the whole path, in order. There is no staging step in it. If you want one anyway, `DEPLOY.md` has it, but nothing here needs it.

It assumes thebrandit.ng is already running an earlier version on your host (Render, Docker or Vercel). The database upgrades itself; you do not run anything by hand.

## 1. Before you replace the code (5 minutes)

1. Sign in to the console as admin. Open **Setup** and press **Back up now** (or run `npm run backup`). The site also backs up every night, but take one you can name.
2. Keep your current settings as they are. This version needs **no new settings**. Studio stays closed until you add a picture-maker key, as before.

## 2. Put the new code on the host

Deploy it the way you deployed before (push to the repository your host watches, or upload the project). The build runs `npm ci` and `npm run build`. On the first start the database upgrades itself, once, in a few seconds, up to migration 013 (basket and order lines, Studio in the order, console tables, reminders, company accounts, product groups). The migrations add tables and columns. The only existing data they change are the old product group names ("Cards", "Flyers and posters"…), which become the six new groups unless you had typed your own names.

## 3. Check it (10 minutes)

From any computer:

```
npm run smoke -- https://thebrandit.ng
```

Then in the console:

- **Setup** lists what is connected and what is missing (database, storage, payments, email, backups). Anything it flags says what to fix.
- **Today** opens, **Customers** lists your people, **Payments** lists your payments.
- Open https://thebrandit.ng/products. You should see six groups, the search box, and "Other ways to order".
- Place one real order for the cheapest thing you sell, pay with your own card, see it in **Job queue**, then refund yourself from **Payments**. This is the only test that proves Paystack, files, email and WhatsApp all work together.

## 4. Switch on what is new (15 minutes, in the console)

| Where | What to do |
| --- | --- |
| **Business details** | Type your WhatsApp number, phone, email, address and opening hours. The site shows them straight away. |
| **Homepage** | Optional: a headline, an announcement bar, the products you want featured, the Founding counter. |
| **Products, Sample pack** | Set the price you want, then switch it on. It cannot be sold until it has a price. |
| **Growth** | Reminders are on by default (90 days after delivery, 8am to 8pm Lagos only). Change the days or switch them off here. |
| **Team** | Add the people who will use **New order** (support and production lead can build orders from WhatsApp chats). Everyone has their own PIN. |
| **FAQ and policies** | Have a lawyer read the Terms, Privacy and Refunds pages. Paste their version in here (the old text is kept), then tick the lawyer box under **Business details**. |

## 5. WhatsApp messages (do this on day one; it takes Meta a few days)

Open `WHATSAPP_TEMPLATES.md` and submit the four templates that are new in this version: `brandit_pay_link` (category **Utility**), and `brandit_reorder_reminder`, `brandit_reorder_weekly` and `brandit_sample_credit` (category **Marketing**), plus their `_pcm` versions if you use Pidgin. Until Meta approves a message, it goes by SMS if Termii is set up, and otherwise it is only logged. Nothing breaks.

## 6. What you still need from outside

These are the only things that cannot be done for you. The shop works without the ones marked optional.

| Need | Why | Without it |
| --- | --- | --- |
| Postgres database | Orders and customers | Required |
| Paystack live key and webhook | Taking money | Required |
| R2 or S3 bucket (or a disk) | Customers' artwork files | Required |
| Resend, or Google sign-in | Customers signing in at checkout | At least one is required |
| Admin email and PIN | The first console login | Required |
| Your domain | thebrandit.ng | Required |
| Termii | SMS codes and fallback | Optional |
| WhatsApp Business Platform | Automatic order messages | Optional (SMS or no message) |
| A picture-maker key | Brandit Studio | Optional (Studio stays closed) |

## 7. If something goes wrong

- The host keeps the previous deploy, and you can roll back to it from the host's dashboard. An older version should still run against the upgraded database, because the upgrade adds rather than removes, but that is not guaranteed for a version older than your last one. If a roll-back misbehaves, restore the backup from step 1: `npm run restore -- --list`, then `npm run restore -- <name> --check`, then `--into "<database>" --yes`.
- Every change made in the console is in **Activity log** with who made it.

## What is honest to tell your customers and team

- Prices marked "estimate" in the console were filled from other Lagos printers and need your own costs before you rely on the margin figures. Only the costs you entered are exact.
- The 24-hour limits per product are starting assumptions. Time each product and set the real ones in **Delivery and rules**.
- A Studio credit pack and Studio extras are bought separately from the print.
- Lists of names do not carry photos yet.
