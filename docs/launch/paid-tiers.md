# Paid tiers — owner action checklist

Line Select currently runs on free / non-commercial tiers of its outside services. That is fine for
development and for the invite-only testing so far, but **every one of these free tiers forbids or throttles
real commercial use**, so they must be upgraded *before* pilots are charged the $20/mo membership.

This is an **owner-action list**: each item is an account signup or billing change only you can do (they need a
card and your login). Nothing here requires a code change — the one code change the move needs (the Open-Meteo
key switch) is already merged and waits only for the env var in step 1.

Prices and limits were checked **13 Nov 2026** against the vendors' own pages. Treat the dollar figures as
"confirm at signup" — vendors change them. Links point at the official pricing pages.

---

## 1. Open-Meteo — weather (commercial licence + API key)

**Why:** `src/lib/weather-client.ts` fetches layover weather (typical, forecast, and current) from Open-Meteo.
The free API is licensed **non-commercial use only** — charging pilots makes our use commercial, so we need a
paid plan with an API key.

**What the app uses:** two Open-Meteo APIs —
- the **Forecast API** (16-day forecast + current conditions), and
- the **Historical Weather / archive API** (`typicalWeather` — last year's weather over the bid month).

**Which plan — read this carefully.** The archive API is the catch:
- **Standard — ~$29/mo, 1M calls/mo.** Forecast API only. **Does *not* include the Historical Weather API.**
- **Professional — ~$99/mo, 5M calls/mo.** Adds the Historical Weather (archive) API.

So the "~$29/mo plan" in our earlier notes covers the forecast/current calls but **not** the "what was it like
there last year" panel. Options, your call:
  1. **Buy Professional (~$99/mo)** and keep every weather feature. Simplest, most expensive.
  2. **Buy Standard (~$29/mo)** and accept that the "typical weather last year" panel goes dark (the forecast and
     current-conditions still work). The code already fails that panel gracefully — `typicalWeather` returns
     `null` and the UI just omits it — so no code change is needed to run this way, but a `customer-archive-api`
     call without an archive entitlement will 4xx and the panel will be empty on every city.
  3. **Email Open-Meteo** (`info@open-meteo.com`) to confirm the current tier boundary before you pay — their
     public pricing page quotes call budgets, not dollar prices, and third-party trackers disagree on exactly
     which APIs Standard includes. Verify archive access is in writing for whatever you buy.

**How to turn it on once bought:** set **`NEXT_PUBLIC_OPEN_METEO_API_KEY`** to your key in Vercel → Project →
Settings → Environment Variables (Production), then redeploy. The app then calls
`customer-api.open-meteo.com` and `customer-archive-api.open-meteo.com` with `&apikey=…` automatically; unset,
it stays on the free hosts. The CSP already allows both commercial hosts (`next.config.ts`).

**⚠️ Read before you set the key — denial-of-wallet risk.** The weather calls run **in the pilot's browser**
(the cities screen is a client component), so a `NEXT_PUBLIC_…` key is **baked into the public page bundle and
visible to anyone** who opens the site or View-Source. Open-Meteo bills per call against your 1M/5M budget, so a
stranger (or a scraper) can burn your quota and run up the bill. Before enabling in production, do at least one:
  - Ask Open-Meteo whether the key can be **domain/referrer-restricted** to `lineselect.*` (confirm in writing).
  - Set a **hard monthly call cap / billing alert** in the Open-Meteo customer portal so a runaway can't bill
    past a figure you choose.
  - Longer term, move the three weather fetches behind a **server route** (`/api/weather`) so the key stays on
    the server and never ships to the browser. This is a code change, out of scope for the launch flip, but it
    is the real fix — track it as a follow-up.

**Links:** <https://open-meteo.com/en/pricing> · announcement: <https://openmeteo.substack.com/p/api-subscriptions-for-commercial>

---

## 2. Resend — transactional email (paid plan)

**Why:** Resend sends the account/email-confirmation, crash, and feedback emails. The **free tier is 3,000
emails/month, hard-capped at 100/day**, and signups are throttled (~40/hour early on). A beta of any real size
blows past 100/day the first busy morning, and over-cap sends simply fail — pilots then never get their
confirmation email and can't sign in.

**Buy:** **Resend Pro — ~$20/mo**, 50,000 emails/month, no daily cap (overage ~$0.90 per 1,000). The next tier
(Scale, ~$35/mo, 100,000) is not needed at beta size.

**Also do (not optional):**
  - **Verify the sending domain** (`lineselect.*`) in Resend and add the **SPF + DKIM** DNS records it gives you.
    Without this, mail either doesn't send from your domain or lands in spam. This is the single most common
    launch-day email failure.
  - Point `RESEND_API_KEY` (and the from-address env var, if set) at the production key in Vercel.

**Link:** <https://resend.com/pricing>

---

## 3. Vercel — hosting (Pro plan)

**Why:** the app is deployed on Vercel. The **Hobby plan is free but explicitly non-commercial / personal use
only** — running a paid product on Hobby violates Vercel's fair-use terms and risks the project being suspended.
Pro also raises the function/bandwidth limits a real user base needs.

**Buy:** **Vercel Pro — ~$20 per user/month** (includes ~$20 of usage credit; usage beyond that is metered, so
watch the usage dashboard). One seat is enough to start.

**Also do:**
  - Turn on **Spend Management** in Vercel (set a monthly spend limit + alert) — Pro's usage is metered and can
    surprise you; this is the hosting equivalent of the weather billing cap above.
  - Confirm all production env vars (database URL, Resend key, Open-Meteo key, AssemblyAI key, PostHog, Google
    Places) are set for the **Production** environment, not just Preview.

**Link:** <https://vercel.com/pricing>

---

## 4. Neon — Postgres database (paid plan)

**Why:** the database is the one place where data loss is unrecoverable. The **free tier's history / restore
window is short (hours, not days) and there is no practiced restore**, which is not acceptable once pilots'
accounts, drafts, and saved work live in it. A paid plan buys a longer point-in-time-restore (PITR) window and
room to grow.

**Buy:** Neon's entry paid plan (**Launch, ~$19/mo** at last check) for the longer history-retention / PITR
window and higher limits; confirm the exact retention days at signup and pick the plan whose window you're
comfortable losing data within.

**Also do:**
  - Set the **history-retention / PITR window** as long as the plan allows (7 days is the usual Launch default).
  - **Run the restore drill in `docs/launch/backup-restore-runbook.md` at least once** before launch, and write
    the date you did it at the top of that file. A backup you've never restored is a guess, not a backup.
  - Add a Neon **billing alert / spend cap** if available.

**Link:** <https://neon.tech/pricing>

---

## Quick summary

| Service | Free tier problem | Buy | ~Cost/mo |
|---|---|---|---|
| Open-Meteo | non-commercial licence; archive needs higher tier | Standard ($29) or Professional ($99) — see §1 | $29–99 |
| Resend | 100 emails/day cap, throttled | Pro | $20 |
| Vercel | Hobby is non-commercial only | Pro | $20 (+ usage) |
| Neon | short restore window, no practiced restore | Launch (confirm) | ~$19 |

Rough floor: **~$90/mo** if Open-Meteo Standard is enough, **~$160/mo** with Open-Meteo Professional — before
metered usage on Vercel/Neon. Fold this into the five-month cost plan.

**Do not** flip `NEXT_PUBLIC_OPEN_METEO_API_KEY` on in production until the denial-of-wallet mitigation in §1 is
in place.
