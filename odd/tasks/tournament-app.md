# Feature: tournament-app

## Objective
Lightweight, multi-tournament web app replacing the stakeholder's Google Sheet: round-robin fixture, live standings, playoffs, and an admin backoffice. Public pages are embedded in Google Sites by URL (`/t/<slug>`).

## Problem / Why
The current sheet mixes schedule, detail and standings with hand-typed points, has no match-winner concept, and cannot be reused for future tournaments.

## Scope
- Backoffice (password login): tournaments, teams, fixture generation + manual edit, result entry, playoffs.
- Public read-only site with live updates (SSE): Matches / Standings / Playoffs tabs.
- Docker deploy (node:22-slim + SQLite volume). HTTPS proxy config once the domain is known.

## Constraints
- Node + TypeScript, Hono (hono/jsx SSR, streamSSE), better-sqlite3, NO ORM, Vitest.
- Vanilla HTML/CSS/JS on the client, no client build.
- Own forward-only migrations `migrations/NNN_name.sql`, version in `PRAGMA user_version`, one transaction per file, app refuses to start on failure. `foreign_keys = ON`, `journal_mode = WAL`.
- All SQL isolated in a repository module.
- Visual reference: `E:\PROYECTOS_NODE\PC\fixture-torneo\index.html` (dark esports broadcast, gold accent, Saira Condensed + Figtree).
- Nothing runs on the VPS without explicit user authorization.

## Business rules (confirmed by stakeholder)
- Group stage: single round-robin; odd team count → one bye per round.
- Match: win = 1 point, loss = 0, no draws. Admin records winner + kills/deaths per team.
- Standings order: points desc → K−D desc → kills desc. Still tied → flagged as unresolved (tiebreaker match decided off-app).
- Top N advance (N = 4 for the current tournament). Semis: 1st vs 4th, 2nd vs 3rd; final between semi winners → champion.

## TDD
- Mode: Strict TDD (source: user global config). Runner: Vitest (`npx vitest run`).
- Applies to: migrator, fixture generator, standings, playoffs, repository.

## Tasks
- [ ] T1 Scaffold (package.json, tsconfig, vitest) + migration runner (TDD) + `001_init.sql` — route: delegated writer
- [ ] T2 Round-robin fixture generator (circle method, byes, schedule slots) (TDD) — route: delegated writer
- [ ] T3 Standings calculation + qualification + unresolved-tie flag (TDD) — route: delegated writer
- [ ] T4 Playoff bracket (seeding, winners, champion) (TDD) — route: delegated writer
- [ ] T5 Repository module (SQL) with in-memory DB tests — route: delegated writer
- [ ] T6 Backoffice: auth, tournaments, teams, fixture, results, playoffs — route: delegated writer
- [ ] T7 Public site `/t/:slug` + SSE live updates, mockup design — route: delegated writer
- [ ] T8 Seed script for the current tournament (7 teams, sheet fixture, Oct 3/10/11/17) — route: delegated writer
- [ ] T9 Dockerfile + docker-compose (+ Caddy once domain known) — route: delegated writer

## Acceptance criteria
- Standings and playoffs derive only from match results (no stored points).
- Seeded current tournament reproduces the sheet's 21-match fixture exactly.
- Public page updates without reload when an admin saves a result.
- `npx vitest run` and `npx tsc --noEmit` pass.

## Open questions
- Domain/subdomain for HTTPS.
- Single vs multiple admins (model supports many; seeded from `ADMIN_PASSWORD`).

## Delivery
- Strategy: ask-on-risk. No git remote yet, so no PRs; work-unit commits on `feat/tournament-app`. Chain strategy asked once a remote exists.

## Progress / Evidence
- (none yet)

## Next step
T1.
