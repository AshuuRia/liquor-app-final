# Liquor Inventory System

A web app for Michigan liquor inventory workflows: loads the Michigan LARA price book, supports barcode scanning to build label sessions, price comparison against register exports, and generates Brother QL-820NWB label HTML for printing.

## Run & Operate

- **Dev**: `npm run dev` (runs on port 5000, uses Neon PostgreSQL)
- **Build**: `npm run build`
- **DB push** (dev Neon schema): `npm run db:push`
- **Required env vars**: `DATABASE_URL` (Neon PostgreSQL, dev only)

## Stack

- **Runtime**: Node.js 20
- **Backend (dev)**: Express + TypeScript via `tsx`
- **Backend (prod)**: Hono on Cloudflare Pages Functions (Workers runtime)
- **Frontend**: React 18 + Wouter + Tailwind CSS + Radix UI
- **ORM (dev)**: Drizzle ORM with Neon HTTP adapter (`drizzle-orm/neon-http`)
- **ORM (prod)**: Drizzle ORM with D1 adapter (`drizzle-orm/d1`)
- **Database (dev)**: Neon PostgreSQL
- **Database (prod)**: Cloudflare D1 (SQLite, free tier)
- **Build**: Vite (client)
- **File uploads**: multer (dev) / FormData API (prod)
- **Data parsing**: xlsx + custom TSV parser

## Where things live

- `server/index.ts` — Express entry point (dev only)
- `server/routes.ts` — Express API endpoints (dev only)
- `server/storage.ts` — Neon PostgreSQL data access layer (dev only)
- `server/utils.ts` — Shared helpers: `parseTsvLine`, `toBottleBarcode`, `generateLabelHTML`, `normalizeUpc`
- `server/vite.ts` — Vite dev middleware + static serving
- `functions/api/[[path]].ts` — Hono app for Cloudflare Pages Functions (prod API)
- `functions/_schema.ts` — SQLite/D1 schema (Drizzle sqlite-core)
- `functions/_storage.ts` — D1Storage class using Drizzle D1 adapter
- `migrations/d1/0001_init.sql` — D1 table creation SQL (apply once on first deploy)
- `shared/schema.ts` — Postgres Drizzle schema (dev only, source of truth for dev types)
- `client/src/App.tsx` — React routes (bottom tab nav)
- `client/src/pages/` — Page components
- `vite.config.ts` — Vite config with `@`, `@shared`, `@assets` aliases
- `wrangler.toml` — Cloudflare Pages/Workers config (add your D1 database_id here)

## Architecture decisions

- **Two separate backends**: Express (dev/Replit) and Hono Pages Functions (prod/Cloudflare). They share `server/utils.ts` but use different storage implementations and schemas.
- **D1 (SQLite) for prod**: No connection strings needed — D1 is injected as `env.DB` by Cloudflare runtime.
- **IDs generated in JS**: `crypto.randomUUID()` (no `gen_random_uuid()` in SQLite).
- **Timestamps as ISO strings**: stored as TEXT in D1, serialized naturally to JSON.
- **Batch inserts**: 13,899 liquor records inserted in chunks of 50 via `db.batch()`.
- **Price overrides**: stored as `override_price` on the `scanned_items` row.

## Product

- 13,899+ Michigan liquor records (loaded once via More → Refresh Data, persists in D1 permanently)
- Barcode scanner tab: scan UPCs via camera, build label sessions, resolve duplicates
- Session tab: swipe to delete, clear all with confirmation sheet, localStorage auto-backup/restore
- Price compare tab: upload register CSV, compare vs Michigan shelf prices, export P-touch CSV
- Label generation: produces Brother QL-820NWB print-ready HTML
- Custom UPC→name mappings uploadable per session

## Cloudflare Pages + D1 Deployment Tutorial

### Prerequisites
- A free Cloudflare account at cloudflare.com
- Node.js installed on your computer
- Your code pushed to a GitHub repository

---

### Step 1 — Install Wrangler CLI

Wrangler is Cloudflare's command-line tool. Install it globally:

```bash
npm install -g wrangler
```

Then log in to your Cloudflare account:

```bash
wrangler login
```

A browser window will open — authorize Wrangler. Come back to the terminal when done.

---

### Step 2 — Create the D1 Database

```bash
npx wrangler d1 create liquor-inventory-db
```

You'll see output like:

```
✅ Successfully created DB 'liquor-inventory-db'

[[d1_databases]]
binding = "DB"
database_name = "liquor-inventory-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Copy that `database_id` value** — you need it in the next step.

---

### Step 3 — Update wrangler.toml

Open `wrangler.toml` in the project root and replace `REPLACE_WITH_YOUR_DATABASE_ID` with the ID you just copied:

```toml
[[d1_databases]]
binding = "DB"
database_name = "liquor-inventory-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   ← paste here
```

---

### Step 4 — Apply the Database Migration

Create all the tables in your new D1 database:

```bash
npx wrangler d1 execute liquor-inventory-db --file=migrations/d1/0001_init.sql
```

You should see confirmation that the SQL executed successfully. This only needs to be done once.

To verify the tables were created:

```bash
npx wrangler d1 execute liquor-inventory-db --command="SELECT name FROM sqlite_master WHERE type='table'"
```

---

### Step 5 — Push Code to GitHub

If you haven't already, push this project to a GitHub repository:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

---

### Step 6 — Create a Cloudflare Pages Project

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and click **Workers & Pages** in the left sidebar
2. Click **Create application** → **Pages** tab → **Connect to Git**
3. Authorize Cloudflare to access your GitHub account
4. Select your repository and click **Begin setup**

---

### Step 7 — Configure Build Settings

On the "Set up builds and deployments" screen:

| Setting | Value |
|---|---|
| **Build command** | `vite build` |
| **Build output directory** | `dist/public` |
| **Root directory** | *(leave blank)* |

Do **not** add any environment variables here — the D1 database uses a binding instead of a connection string.

Click **Save and Deploy**.

---

### Step 8 — Add the D1 Database Binding

After the first deployment (even if it fails on the first try):

1. Go to your Pages project → **Settings** → **Functions**
2. Scroll to **D1 database bindings**
3. Click **Add binding**
4. Set **Variable name** to `DB`
5. Select `liquor-inventory-db` from the dropdown
6. Click **Save**

---

### Step 9 — Redeploy

After adding the binding, trigger a new deployment:

1. Go to your Pages project → **Deployments**
2. Click the **...** menu on the latest deployment → **Retry deployment**

Or push any new commit to GitHub — Cloudflare Pages deploys automatically on every push.

---

### Step 10 — Load the Michigan Liquor Data

Once your app is live at `https://your-project.pages.dev`:

1. Open the app on your phone or computer
2. Tap the **More** tab (bottom right)
3. Tap **Refresh Data**
4. Wait about 5–10 seconds while 13,899 records are fetched from the Michigan state website and loaded into D1
5. You're ready to scan!

The data is now stored permanently in D1. You only need to do this again if the Michigan price book updates (usually monthly).

---

### Free Tier Limits (You Won't Hit These)

| Service | Free Limit |
|---|---|
| Cloudflare Pages | Unlimited requests, 500 builds/month |
| Pages Functions | 100,000 requests/day |
| D1 (SQLite) | 5 GB storage, 5M reads/day, 100K writes/day |

---

### Testing Locally with D1

To run the Cloudflare Pages frontend + D1 locally (instead of the Express dev server):

```bash
# Build the frontend first
npm run build

# Then start the Pages dev server (emulates D1 locally)
npx wrangler pages dev dist/public
```

Note: the normal `npm run dev` command uses Express + Neon Postgres (good for rapid frontend development on Replit). Use `wrangler pages dev` only when you need to test the exact Cloudflare runtime locally.

## User preferences

_Populate as you build_

## Gotchas

- `tsx` must be invoked via `npx tsx` in the dev script (not bare `tsx`) to ensure it resolves from node_modules
- Michigan LARA price book URL changes monthly — update the URL in `functions/api/[[path]].ts` (the `/fetch-liquor-data` route)
- D1 binding must be added in the Pages dashboard (Step 8) AND wrangler.toml must have the correct `database_id` (Step 3)
- `crypto.randomUUID()` is a global in Workers — no import needed
- D1 `db.batch()` limit: keep chunks ≤ 50 statements for reliability
- The `functions/_schema.ts` and `functions/_storage.ts` files are prefixed with `_` so Cloudflare Pages does NOT treat them as route handlers

## Pointers

- Dev schema: `shared/schema.ts` (Postgres)
- Prod schema: `functions/_schema.ts` (SQLite/D1)
- D1 storage class: `functions/_storage.ts`
- Hono API entry: `functions/api/[[path]].ts`
- Michigan data fetch: `POST /api/fetch-liquor-data`
- D1 migration: `migrations/d1/0001_init.sql`
