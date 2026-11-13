# Keeping local work off the live database

Until now there was no separation between the development and production
databases. `.env.local`'s `DATABASE_URL` is the **live Neon database**, so
`npm run dev`, `npm run db:migrate`, and ad-hoc `tsx scripts/…` runs all wrote
straight to real pilots' accounts and trades. Now that pilots are paying, one
careless migration or stray `delete` could corrupt customer data.

This project now has a guard (`src/lib/server/db-guard.ts`) that refuses to let
a local process touch a production-looking database unless you opt in on
purpose. This note explains how to set up a safe database for local work and
exactly how the guard decides what to block.

## 1. Point local work at a safe database

Pick one of these. The first is easiest and matches how the app is hosted.

### Option A — a Neon branch (recommended)

Neon can branch the production database into a separate, isolated copy with its
own connection string. Changes to a branch never reach `main`.

1. In the Neon console, open the project and create a branch of `main` (name it
   `dev` or `test` — anything but production).
2. Copy that branch's **pooled** connection string.
3. Put it in `.env.local`:

   ```sh
   DATABASE_URL=postgresql://…@ep-your-dev-branch-…neon.tech/neondb?sslmode=require
   # optional but strongly recommended — see "How the guard decides" below:
   PRODUCTION_DB_HOST=ep-your-PROD-endpoint-id
   ```

4. Apply the schema to the branch once:

   ```sh
   npm run db:migrate
   ```

### Option B — a local Postgres

```sh
# with Postgres installed locally, or via Docker:
docker run --name line-select-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
```

```sh
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/line_select
```

```sh
npm run db:migrate
```

`localhost` / `127.0.0.1` are always treated as safe, so no extra env is needed.

### Running the integration tests

`src/lib/server/db.test.ts` runs only when `TEST_DATABASE_URL` is set, and it
**creates and deletes rows**, so it must point at a non-production database —
use your dev branch or local Postgres (migrate it first). The test refuses to
run if `TEST_DATABASE_URL` looks like production.

```sh
TEST_DATABASE_URL=postgresql://…dev-branch… npm run db:migrate   # once
TEST_DATABASE_URL=postgresql://…dev-branch… npm test
```

## 2. How the guard decides what's "production"

The guard looks at the connection string and the environment:

- **On Vercel** (`VERCEL` is set and it's the deployed production server, not
  development) the app connects as before — the platform wires the correct
  database per environment, so the guard never interferes with a deploy. A
  `.env.local` made by `vercel env pull` carries `VERCEL="1"` too, so `VERCEL`
  alone doesn't open the fence for `npm run dev` or a script.
- **`localhost` / `127.0.0.1` / `*.local`** are always safe.
- **If you set `PRODUCTION_DB_HOST`** (recommended), a string whose host
  contains it is production and everything else is safe. This is the reliable
  signal: Neon branch endpoints get random hostnames that don't contain the
  branch name, so naming alone can't recognise a dev branch. The pooled host
  (`…-pooler.…`) and the direct one count as the same, so either works.
- **Otherwise**, a `dev` / `test` / `staging` / `sandbox` / `preview` / `ci` /
  `local` / `scratch` token in the host or database name marks it safe. Any
  other remote host is assumed to be **production** (fail-safe: an unknown
  database errs toward being refused, never toward a silent write).

### What gets blocked

- **`npm run dev`** (and anything that opens the app's pool locally) refuses to
  connect to a production-looking database.
- **`npm run db:migrate`** refuses to migrate a production-looking database.
- **`scripts/rehash-pilot-hashes.ts --apply`** and
  **`scripts/purge-legacy-sessions.ts --apply`** refuse their destructive
  write against production. Their dry-run (no `--apply`) still works, since it
  only counts and rolls back.

## 3. The deliberate opt-in: `ALLOW_PRODUCTION_DB=1`

When you genuinely mean to touch production — applying a migration during a
deploy, or running a one-off maintenance script against the live data — set the
flag for that one command:

```sh
ALLOW_PRODUCTION_DB=1 npm run db:migrate
```

```sh
ALLOW_PRODUCTION_DB=1 PILOT_HASH_SECRET=… npx tsx scripts/rehash-pilot-hashes.ts --apply
```

Keep it scoped to the single command. Do **not** put `ALLOW_PRODUCTION_DB` in
`.env.local`, or the fence is permanently open and you're back to the original
hazard.
