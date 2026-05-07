# Liquor Inventory System

A web app for Michigan liquor inventory workflows: loads the Michigan LARA price book, supports barcode scanning to build label sessions, price comparison against register exports, and generates Brother QL-820NWB label HTML for printing.

## Run & Operate

- **Dev**: `npm run dev` (runs on port 5000)
- **Build**: `npm run build`
- **Start (prod)**: `npm start`
- **DB push**: `npm run db:push`
- **Required env vars**: `DATABASE_URL` (Neon PostgreSQL)

## Stack

- **Runtime**: Node.js 20
- **Backend**: Express + TypeScript via `tsx` (dev) / Hono (Cloudflare Pages prod)
- **Frontend**: React 18 + Wouter + Tailwind CSS + Radix UI
- **ORM**: Drizzle ORM with Neon HTTP adapter (`drizzle-orm/neon-http`)
- **Build**: Vite (client) + esbuild (server)
- **File uploads**: multer (Express dev) / FormData API (Hono CF Pages)
- **Data parsing**: xlsx + custom TSV parser

## Where things live

- `server/index.ts` — Express entry point (dev only)
- `server/routes.ts` — Express API endpoints (dev only)
- `server/storage.ts` — Data access layer; `DatabaseStorage` uses Neon HTTP, works in Node.js and Workers
- `server/utils.ts` — Shared helpers: `parseTsvLine`, `toBottleBarcode`, `generateLabelHTML`, `normalizeUpc`
- `server/vite.ts` — Vite dev middleware + static serving
- `functions/api/[[path]].ts` — Hono app for Cloudflare Pages (all API routes, Workers-compatible)
- `shared/schema.ts` — Drizzle table definitions + Zod schemas (source of truth)
- `client/src/App.tsx` — React routes (bottom tab nav)
- `client/src/pages/` — Page components
- `vite.config.ts` — Vite config with `@`, `@shared`, `@assets` aliases
- `wrangler.toml` — Cloudflare Pages/Workers config

## Architecture decisions

- **Liquor records now live in the DB** (previously in-memory). Must load once via More → Refresh Data; data then persists permanently.
- `DatabaseStorage` uses `@neondatabase/serverless` HTTP driver — identical behaviour on Node.js and Cloudflare Workers (no WebSocket).
- Price overrides are stored as `override_price` on the `scanned_items` row (not as cloned records).
- `DatabaseStorage` constructor takes `databaseUrl` string; Express uses `process.env.DATABASE_URL`, Hono uses `c.env.DATABASE_URL`.
- Vite runs in middleware mode during development (same Express server serves API + frontend).

## Product

- 13,899+ Michigan liquor records from the state website (loaded once, persists in DB)
- Barcode scanner tab: scan UPCs via camera, build label sessions, resolve duplicates
- Session tab: swipe to delete, clear all with confirmation sheet, localStorage auto-backup/restore
- Price compare tab: upload register CSV, compare vs Michigan shelf prices, export P-touch CSV
- Label generation: produces Brother QL-820NWB print-ready HTML
- Custom UPC→name mappings uploadable per session

## Cloudflare Pages Deployment

1. Push project to GitHub
2. Create a new Cloudflare Pages project, connect the repo
3. Set **Build command**: `vite build`
4. Set **Output directory**: `dist/public`
5. Under **Environment Variables**, add `DATABASE_URL` as a secret (same Neon URL)
6. Deploy — Cloudflare Pages auto-detects `functions/` and serves `/api/*` via the Hono Workers function
7. After first deploy, open the app → More tab → Refresh Data to populate the DB

## User preferences

_Populate as you build_

## Gotchas

- `tsx` must be invoked via `npx tsx` in the dev script (not bare `tsx`) to ensure it resolves from node_modules
- Michigan LARA price book URL changes monthly — update the URL in both `server/routes.ts` and `functions/api/[[path]].ts`
- `DATABASE_URL` must be set before starting; the server throws immediately if missing
- Liquor records table starts empty after migration — hit More → Refresh Data once to load Michigan data into DB

## Pointers

- Drizzle schema: `shared/schema.ts`
- Michigan data fetch: `POST /api/fetch-liquor-data` (in both routes.ts and functions file)
- CF Pages function entry: `functions/api/[[path]].ts` exports `onRequest = app.fetch`
