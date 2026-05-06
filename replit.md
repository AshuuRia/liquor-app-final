# Liquor Inventory System

A full-stack liquor inventory and label management app that auto-loads pricing data from the Michigan LARA Price Book, supports barcode scanning, and generates shelf labels for Brother QL printers.

## Run & Operate

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server (port 5000) |
| `npm run build` | Build for production |
| `npm run start` | Run production build |
| `npm run db:push` | Push schema to PostgreSQL |

Required env vars: `DATABASE_URL` (PostgreSQL, provisioned via Replit DB)

## Stack

- **Frontend**: React 18 + TypeScript, Vite, Wouter (routing), TanStack Query, Tailwind CSS, shadcn/ui (Radix UI)
- **Backend**: Node.js 20, Express.js, TypeScript (ESM), tsx (dev), esbuild (prod)
- **Database**: PostgreSQL via `pg` (node-postgres) + Drizzle ORM — works with Neon, Replit Postgres, or any Postgres URL
- **Barcode**: `@zxing/library`, `@undecaf/zbar-wasm` (WASM, client-side)
- **Files**: Multer (uploads), XLSX (Excel generation)

## Where things live

- `client/src/pages/` — main views (converter, scanner, price-compare)
- `client/src/components/` — UI components (barcode-scanner, file-upload, etc.)
- `server/routes.ts` — all API routes
- `server/storage.ts` — data access layer (currently `MemStorage`; `DatabaseStorage` stub present)
- `shared/schema.ts` — Drizzle schema + Zod types (source of truth)
- `drizzle.config.ts` — DB config

## Architecture decisions

- Uses `MemStorage` in-memory store for all data; `DatabaseStorage` is stubbed but not implemented
- Liquor data is fetched from Michigan state website on every app startup via `POST /api/fetch-liquor-data`
- Labels are generated as HTML/CSS optimized for 2.4"×1.2" Brother QL-820NWB printer format
- No authentication or login flow — the app is open access by design
- Sessions (scanning sessions) are application-level, not HTTP sessions; passport/connect-pg-simple are unused dependencies

## Product

- Auto-fetches and parses ~13,900 liquor price records from Michigan LARA Price Book
- Barcode scanner page (camera-based) looks up scanned items against the price book
- Groups scanned items into named sessions for batch label printing
- Custom name mapping via CSV/Excel upload to override product labels
- Price comparison view and Excel export of processed data

## User Preferences

- Preferred communication style: Simple, everyday language.

## Gotchas

- `DatabaseStorage` class exists in `storage.ts` but all methods throw — only `MemStorage` is active
- Data reloads from michigan.gov on every server restart (takes ~7 seconds)
- `passport`, `passport-local`, `connect-pg-simple`, `express-session`, `memorystore` are installed but not wired up

## Pointers

- Schema: `shared/schema.ts`
- API routes: `server/routes.ts`
- Replit DB skill: `.local/skills/database/SKILL.md`
