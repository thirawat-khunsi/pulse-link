# CLAUDE.md — Pulse Link

**Source of truth: `docs/SPEC.md`.** This file is a summary; if they disagree, SPEC wins.

## Goal
Short URL system ("Pulse Link", 2-day developer test): create short links (Sqids or Thai/Latin alias),
302 redirect, QR codes that count scans separately from clicks, history list, and a real-time click-stats
dashboard. Must run online (free host + external Postgres) and via `docker compose up`.

## Stack
- Node.js 20+, TypeScript (strict), Fastify, PostgreSQL (`pg`), zod, `sqids`, `qrcode`, `ua-parser-js`,
  `@fastify/{static,rate-limit,helmet,cookie}`
- Frontend: React + Vite + TS in `web/`, built and served as static files by Fastify; hash routing; Thai UI
- Tests: Vitest with `fastify.inject`, separate test DB
- Migrations: plain SQL in `db/migrations/` + small runner (no ORM). No Redis, no login.
- Do not add dependencies beyond these without stating why.

## Structure (modular monolith, splittable into services)
```
src/modules/{links,redirect,clicks,qr,stats}   feature modules
src/shared/                                     config, db, errors, utils
src/entry/{all,api,redirect}.ts                 entrypoints per APP_MODE
web/                                            React + Vite frontend
db/migrations/                                  SQL migrations
docs/                                           SPEC, ARCHITECTURE, DFD, ER, DEPLOY, DEMO, DECISIONS
```
`APP_MODE`: `all` (default) | `api` (/api + static + /health) | `redirect` (/:code + /health). Same DB.

## Commands
```
npm run dev        # dev server
npm run build      # build server + web
npm start          # run built app
npm test           # vitest
npm run lint
npm run typecheck
npm run migrate    # apply db/migrations
npm run seed       # demo links + 14 days of clicks
docker compose up  # app + postgres
```
Env (see `.env.example`): `DATABASE_URL, BASE_URL, PORT, APP_MODE, TRUST_PROXY, CLICK_FLUSH_MS, NODE_ENV`.

## Key invariants (details in SPEC §2–§7)
- Redirects are 302 only, `Cache-Control: no-store`; click logging is buffered, never blocks the redirect.
- `max_clicks` links use a single atomic UPDATE, never the cache. HEAD requests are not counted.
- Ownership via `pl_owner` cookie; another owner's link → 404. Errors: `{ error: { code, message(Thai) } }`.

## Working rules (SPEC §12)
- Start every phase by reading CLAUDE.md and docs/SPEC.md; plan before large tasks.
- Work in small milestones; before ending a phase run typecheck, lint, test until green,
  then commit using conventional commits.
- Write tests together with the code, not afterwards.
- If SPEC is ambiguous or contradictory, ask before guessing; record any self-made decision in docs/DECISIONS.md.
- Code and comments in English; user-facing text in Thai.
- Never implement anything listed in "Out of scope" (SPEC §11): login/accounts, Redis, GeoIP,
  Safe Browsing checks, bulk CSV, password-protected links, A/B routing.
