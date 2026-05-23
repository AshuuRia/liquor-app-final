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

- Replit Auth (Google/GitHub/Apple/email) is used for login — all user data is scoped by userId
- The app requires login to use any features (landing page shown when signed out)
- Price compare sessions auto-save to the DB every 2 seconds after changes so users can resume from any device

---

## Deploying to Cloudflare Pages with Clerk Auth

The **dev environment** uses Replit Auth. The **production Cloudflare Pages deployment** uses Clerk (free, supports Google/GitHub/Apple/email, works natively in Cloudflare Workers).

The code is already wired — you just need accounts and environment variables. Follow these steps in order.

---

### Part 1 — Create a Cloudflare Pages + D1 Project

Follow Steps 1–9 in the [Cloudflare Pages tutorial](#cloudflare-pages--d1-deployment-tutorial) above to:
- Create the D1 database
- Connect GitHub → Cloudflare Pages
- Set the build command to `vite build` and output to `dist/public`

**Do NOT redeploy yet** — you need Clerk set up first.

---

### Part 2 — Set Up Clerk

1. Go to [clerk.com](https://clerk.com) and create a free account
2. Click **Create application**, give it a name (e.g. "Michigan Liquor")
3. Under **Social connections**, enable **Google** (and optionally GitHub, Apple)
4. Go to **Dashboard → API Keys** and copy:
   - **Publishable key** — starts with `pk_live_...` (or `pk_test_...` for test mode)
   - **Secret key** — starts with `sk_live_...`
5. In your Clerk Dashboard → **Settings → Domains**, add your Cloudflare Pages domain:
   - `https://your-project.pages.dev`

---

### Part 3 — Apply the D1 Migration (user-scoped tables)

Run this once after creating your D1 database. It adds `user_id` to sessions and creates the price compare sessions table:

```bash
npx wrangler d1 execute liquor-inventory-db --file=migrations/d1/0002_user_scoped.sql
```

Verify it worked:
```bash
npx wrangler d1 execute liquor-inventory-db --command="SELECT name FROM sqlite_master WHERE type='table'"
```

You should see: `liquor_records`, `scanned_items`, `sessions`, `custom_name_mappings`, `price_compare_sessions`

---

### Part 4 — Add Environment Variables to Cloudflare Pages

In your Cloudflare Pages project → **Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_...` (your Clerk publishable key) |
| `CLERK_SECRET_KEY` | `sk_live_...` (your Clerk secret key) |

**Important:** `VITE_CLERK_PUBLISHABLE_KEY` is a build-time variable (Vite bakes it in). Set it under **Build variables** as well as runtime variables, or it won't appear in the frontend.

How to add build variables:
- Go to Pages project → Settings → Environment Variables
- Click **Add variable** → set both **Production** and **Preview**
- Do this for BOTH variables

---

### Part 5 — Add the D1 Binding

In your Cloudflare Pages project → **Settings → Functions**:
- Scroll to **D1 database bindings**
- Click **Add binding** → Variable name: `DB` → select `liquor-inventory-db`
- Click **Save**

---

### Part 6 — Deploy

Trigger a deployment:
- Push any commit to GitHub, OR
- Go to Pages → Deployments → click **...** on the latest → **Retry deployment**

After deployment, your app at `https://your-project.pages.dev` will:
1. Show the landing page to unauthenticated users
2. "Sign in" opens Clerk's modal — users pick Google, GitHub, Apple, or email
3. After sign-in, all sessions and price compare data are scoped to that user's account

---

### Part 7 — Load the Michigan Liquor Data

Once logged in on the live site:
1. Tap **More** tab → **Refresh Data**
2. Wait ~10 seconds for 13,899 records to load into D1
3. You're ready to scan

Data is stored permanently in D1. Repeat when the Michigan price book updates (usually monthly).

---

### How the Auth Works (Technical Details)

- **Frontend** (`client/src/lib/clerk.ts`): Loads Clerk JS from CDN when `VITE_CLERK_PUBLISHABLE_KEY` is set. In dev (no env var), Replit Auth is used instead. No npm package required — uses Clerk's CDN.
- **Backend** (`functions/api/[[path]].ts`): Each protected API route requires `Authorization: Bearer <token>`. The Hono middleware fetches Clerk's JWKS, verifies the JWT signature using Web Crypto API, and extracts the `userId` from the `sub` claim. No `@clerk/backend` package needed.
- **User data scoping**: `sessions`, `custom_name_mappings`, and `price_compare_sessions` are all filtered by `user_id` in D1.
- **Dev vs. prod**: The same frontend codebase runs in both environments. If `VITE_CLERK_PUBLISHABLE_KEY` is set → Clerk mode. If not → Replit Auth mode.

---

### Free Tier Summary

| Service | Free Limit |
|---|---|
| Cloudflare Pages | Unlimited requests, 500 builds/month |
| Cloudflare Pages Functions | 100,000 requests/day |
| D1 (SQLite) | 5 GB storage, 5M reads/day, 100K writes/day |
| Clerk | 10,000 monthly active users |

All free. No credit card required for any of these at the scale of a liquor store team.

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
- D1 initial migration: `migrations/d1/0001_init.sql`
- D1 user-scoped migration: `migrations/d1/0002_user_scoped.sql`
- Clerk loader (frontend): `client/src/lib/clerk.ts`
- Auth hook: `client/src/hooks/use-auth.ts`
