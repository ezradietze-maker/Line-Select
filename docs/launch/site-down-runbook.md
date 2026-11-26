# When the site goes down

UptimeRobot checks `https://www.lineselect.app/api/health` every 5 minutes and emails when it fails, and again when
it's back. The health check answers for the site, Redis and the database (`src/lib/server/health.ts`).

## 1. Is it real? (1 minute)

Open https://www.lineselect.app on your phone, on mobile data rather than Wi-Fi. If it loads and UptimeRobot sends "back up"
within 5–10 minutes, it was a blip: do nothing.

## 2. Which part is down? (1 minute)

Open https://www.lineselect.app/api/health in a browser:

| What you see | What's down |
| --- | --- |
| Nothing loads at all | The hosting (**Vercel**): down or paused |
| `"database":"down"` | The database (**Neon**) |
| `"redis":"down"` | The counters and limits store (**Upstash**) |

## 3. Check that service

Search "Vercel status", "Neon status" or "Upstash status".

- **They report a problem:** it's theirs. Wait; it's usually fixed within the hour.
- **All green there:** sign in to that service's dashboard and look for a warning. The usual causes at launch:
  - **Vercel:** a spend limit was hit and the site paused. Raise the limit and it comes back.
  - **Neon:** the free compute hours ran out, or a payment failed.
  - **Upstash:** the free request limit was reached.

## 4. Broke right after an update?

Vercel → **Deployments** → the last version that worked (the one before the newest) → **⋯ → Instant Rollback**. It's
back in seconds; the newest version gets fixed without a rush.

## 5. Bring in Claude

Open a Claude Code session and paste the UptimeRobot email, what `/api/health` showed and what the dashboards said.
Claude can read the logs and errors and fix it from there.

## 6. Tell pilots, if it lasts

Short outage: say nothing. Down more than half an hour during a bid window: a short note to the beta pilots —

> Line Select is down; we're on it. Your bid is safe in VIPS, and you can still bid there directly.

Line Select never holds anyone's bid: pilots submit in VIPS themselves, so an outage is an inconvenience, never a lost
bid. It matters most in the last day or two before bids close: no updates or experiments then.

## Less likely to happen at all

- Vercel Pro, with the spend limit set well above normal use.
- Neon on a paid plan, so compute hours can't run out.

## Don't

- Don't change `ADMIN_API_KEY` in Vercel to fix anything: until `DEVICE_COOKIE_SECRET` is set, it also signs the cookies
  that recognise each pilot's device, and changing it makes the site forget every device.
