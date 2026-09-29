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
- [x] T1 Scaffold (package.json, tsconfig, vitest) + migration runner (TDD) + `001_init.sql` — route: delegated writer
- [x] T2 Round-robin fixture generator (circle method, byes, schedule slots) (TDD) — route: delegated writer
- [x] T3 Standings calculation + qualification + unresolved-tie flag (TDD) — route: delegated writer
- [x] T4 Playoff bracket (seeding, winners, champion) (TDD) — route: delegated writer
- [x] T5 Repository module (SQL) with in-memory DB tests — route: delegated writer
- [ ] T6 Backoffice: auth, tournaments, teams, fixture, results, playoffs — route: delegated writer
- [ ] T7 Public site `/t/:slug` + SSE live updates, mockup design — route: delegated writer
- [ ] T8 Seed script for the current tournament (7 teams, sheet fixture, Oct 3/10/11/17) — route: delegated writer
- [ ] T9 Dockerfile + docker-compose (+ Caddy once domain known) — route: delegated writer

## Stakeholder feedback on mockups (2026-09-29)
- Rules need their own larger section: backoffice "Rules" screen (points per win/loss, ordered tiebreakers, format, free-text rulebook) + public "Rules" tab. Accepted.
- Fixture must support more/fewer teams and extra rounds: generator already adapts to N teams; add single/double round-robin option and manual "add round" / "add match" (e.g. tiebreaker match). Accepted.
- Each team gets a hero emblem picked from the predefined Dota 2 hero list (127 heroes, `odd/mockups/heroes.json`, source OpenDota /api/heroes); one hero per team within a tournament. Confirmed by user.
- Admin model: single role; extra admin users allowed, all with the same role. Confirmed by user.
- Proposed in mockup, NOT yet confirmed: BO1/BO3 series, 2/8 qualifiers, allow draws.
- Public site style: Dota 2 look (Cinzel + Barlow, black/gold, Radiant green vs Dire red). Valve CDN images to be self-hosted in production.

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

## Review log
- T1–T5 range 4e174f8..022e5ef: risk medium, consent granted, native review APPROVED and acknowledged (lineage review-efbd791797c39cae). Reviewed boundary → 022e5ef. Non-blocking findings folded into T6: winner CHECK bypass when a team is NULL (001_init.sql:34), semifinal winner not validated (playoffs.ts:62-70); suggestions: addMinutes validation (fixture.ts:50-56), bracket ignores qualifiers (playoffs.ts:56-58).

## Progress / Evidence
- T1 (9860a63): route delegated writer. RED: migrate.test.ts failed on missing module `src/db/migrate`; GREEN after implementing. Schema tests (schema.test.ts) written alongside 001_init.sql, so no separate RED observed for them. 15 tests.
- T2 (e6c4121): route delegated writer. RED: fixture.test.ts failed on missing module; GREEN 55 total. Fixture tests cover n=2..8 plus 7-team schedule (4+3), insufficient slots error.
- T3 (6b3cea2): route delegated writer. RED: standings.test.ts failed on missing module; GREEN after implementation. One test expectation (last5) was miscalculated in the test and corrected; 15 tests.
- T4 (12e6832): route delegated writer. RED: playoffs.test.ts failed on missing module; GREEN 79 total. 9 tests.
- T5 (737e6c9): route delegated writer. RED: repository.test.ts failed on missing module; GREEN 94 total (6 files). 15 tests.
- Assumptions: playoff auto-seeding also requires no unresolved tie inside the top 4 (seed order ambiguous); admin can assign semifinal teams manually and stored teams take precedence. Standings `unresolvedTie` only among teams with played > 0. `last5` is chronological (oldest first). Deleting a team referenced by matches fails on FK (no cascade).

## Next step
T6.
