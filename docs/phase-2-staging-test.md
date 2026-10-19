# Phase 2 gate: five people, three minutes

**Gate for going live on 18 November:** at least 4 of 5 testers place a paid order on the staging site in 3 minutes or less, and every automatic test passes on staging.

The computer can count taps. It cannot tell how long a real person takes to read, type their number and find their street. Only people can run this test.

## Before the test

1. Open the staging site on your own phone and place one order yourself, so you know it works today.
2. Make sure staging uses test payments only (Paystack test keys) and that the email sign-in sends a real code to a real inbox.
3. Pick five testers who have **not** seen the site before. Mix them: at least two on an Android phone, one on an iPhone, one on a slow connection (mobile data, not Wi-Fi), one who is not comfortable with technology. Nobody from the team.
4. Each tester needs: their own phone, their own email address, a small print file to upload (a screenshot or a photo is fine; send them one if they have none), and a Lagos address to type.
5. Have a second person hold a stopwatch. Do not help during a run.

## What you say to each tester

> You need 100 business cards by Saturday. Here is the file for the cards. Order them on this site and pay with the test card. Please think out loud. I am testing the site, not you.

Give them only the address of the staging home page. Start the stopwatch when the home page appears. Stop it when the page after payment shows the order tracker.

## What to write down for each tester

| Tester | Phone | Connection | Time to paid | Taps (count) | Where they hesitated | What they said |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |

Also note each time a tester:

- asked "what do I press?" or looked for a button for more than 5 seconds
- did not notice the file preview before pressing **Looks right**
- got an error message, and which one
- went back, or closed the panel and reopened it
- gave up on the email code, or asked for another one
- did not find the address field

## Second run: two products in one order (two testers)

Ask two of the five to order **100 business cards and 100 flyers** in one go and pay once. Write down whether they found **Looks right, add another**, whether they understood that delivery is charged once, and the time to paid. This run does not count towards the 4 of 5, but the order must be paid once and show both products on one tracker.

## Third run: coming back (any two testers, next day)

Ask them to open the site on the same phone and order the same cards again from **Account → Same again**. It should take two taps.

## How to read the result

- **4 or 5 testers under 3 minutes:** the gate is passed.
- **3 or fewer:** do not release on 18 November. Look at where people hesitated. The same place for three testers is a design problem, not a tester problem. Fix it and run five new testers.
- **Any tester who paid but could not find their order afterwards:** fix before release, whatever the times say.

## Automatic checks

The unit tests (`npx vitest run`) and the browser checks (`scripts/e2e.ts`) run against a demo-mode copy of the same commit with an empty database, because they use the demo sign-in and the simulated payment. Run them there before the staging test and again before release. They do not run against a site that has real Paystack keys.

`scripts/phone-clicks.mjs` repeats the tap count on a phone-sized browser against a demo-mode site: 5 taps for a new customer, 4 signed in, 2 for Same again. It also checks that 13 pages do not scroll sideways at 360px. See the top of the file for how to run it.
