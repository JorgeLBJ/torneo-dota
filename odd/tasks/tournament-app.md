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
- [x] T6 Backoffice: auth, tournaments, teams, fixture, results, playoffs — route: delegated writer
- [x] T6.1 Hardening + polish from T6 review and visual check — route: delegated writer
  - Rate limit keyed on spoofable X-Forwarded-For (src/security.ts:34-36): only trust the proxy-appended hop when TRUST_PROXY=1.
  - Login limiter: bounded map + eviction (src/auth/rate-limit.ts), check-and-increment without TOCTOU (src/admin/routes/auth.tsx:25-34).
  - Unbounded request body in form parsing (src/admin/form.ts:5-7): cap body size.
  - Tiebreakers read from DB not validated (src/domain/standings.ts:71-72); hero slug not enforced at repository level (repository.ts:301).
  - Tiebreak match ordering (src/admin/routes/fixture.tsx:165-167); end-before-start and unbounded round param (fixture.tsx:97-103, 149-151); tautological tie test (test/services.test.ts:164).
  - Migration comment says "exactly one" active but index allows zero (002:10-12); labels "URL pública"/"Torneo activo" wording (tournaments.tsx:45-46, layout.tsx:84); tournaments.tsx:47-51 edge case.
  - Visual: calendar table columns collapse (phase select and times input too narrow); mobile nav shows a raw horizontal scrollbar.
- [x] T7 Public site `/t/:slug` + SSE live updates, mockup design — route: delegated writer
- [x] T8 Seed script for the current tournament (7 teams, sheet fixture, Oct 3/10/11/17) — route: delegated writer
- [x] T7.1 Time zones: match times stored as UTC instants, per-tournament zone, visitor-local public times — route: delegated writer
- [x] T7.2 Hardening from T6.1/T7 reviews (SSE caps, shared root listener, client backoff, cache policy, small fixes) — route: delegated writer
- [x] T7.3 Visual polish round 2 (phone cards, compact standings, sidebar, favicon, styled selects) — route: delegated writer
- [x] T7.4 Live stream tab (one link per tournament, Kick/Twitch/YouTube, migration 004) — route: delegated writer
- [x] T7.5 Follow-ups from approved reviews (CSS brace, atomic seed, 503 retry, clock boundaries, localize guard, injected clock) — route: delegated writer
- [x] T7.6 Stream follow-ups (clearable invalid link, 300-char cap, server-clock boundaries, robust player-preserving patch) — route: delegated writer
- [ ] T9 Dockerfile + docker-compose (+ Caddy once domain known) — route: delegated writer

## Stakeholder feedback on mockups (2026-09-29)
- Rules need their own larger section: backoffice "Rules" screen (points per win/loss, ordered tiebreakers, format, free-text rulebook) + public "Rules" tab. Accepted.
- Fixture must support more/fewer teams and extra rounds: generator already adapts to N teams; add single/double round-robin option and manual "add round" / "add match" (e.g. tiebreaker match). Accepted.
- Each team gets a hero emblem picked from the predefined Dota 2 hero list (127 heroes, `odd/mockups/heroes.json`, source OpenDota /api/heroes); one hero per team within a tournament. Confirmed by user.
- Admin model: single role; extra admin users allowed, all with the same role. Confirmed by user.
- Proposed in mockup, NOT yet confirmed: BO1/BO3 series, 2/8 qualifiers, allow draws.
- Public site style: Dota 2 look (Cinzel + Barlow, black/gold, Radiant green vs Dire red). Valve CDN images to be self-hosted in production.

## Routing and active tournament (confirmed by user, 2026-09-29)
- Exactly ONE active tournament at a time (`tournaments.is_active`, partial unique index). `/` renders the ACTIVE tournament's public page, `/t/<slug>` any tournament (archive), `/admin` the backoffice (opens the active tournament by default). Admin "Ver página pública" links to `/` for the active tournament and `/t/<slug>` otherwise. The public site itself is T7.
- Production domain: torneo-dota.jpsolutions.com behind HTTPS (`COOKIE_SECURE=1` flag; `TRUST_PROXY=1` behind the proxy).

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
- T6 range 022e5ef..d9d6609: whole range exceeded the reviewer context budget (lens_context_budget_exceeded, nothing created). Reviewed as commit slices in detached worktrees, all consent granted, all APPROVED and acknowledged: 022e5ef..25533b7 (medium, lineage review-6f211b2f0d34b2c8), 25533b7..0aa2783 (high, 4 lenses, review-970799ae64548f40), 0aa2783..4a2d13e (medium), 4a2d13e..ebcfe49 (medium); ebcfe49..d9d6609 passive (docs). Reviewed boundary → d9d6609. Non-blocking warnings → T6.1.

## Progress / Evidence
- T1 (9860a63): route delegated writer. RED: migrate.test.ts failed on missing module `src/db/migrate`; GREEN after implementing. Schema tests (schema.test.ts) written alongside 001_init.sql, so no separate RED observed for them. 15 tests.
- T2 (e6c4121): route delegated writer. RED: fixture.test.ts failed on missing module; GREEN 55 total. Fixture tests cover n=2..8 plus 7-team schedule (4+3), insufficient slots error.
- T3 (6b3cea2): route delegated writer. RED: standings.test.ts failed on missing module; GREEN after implementation. One test expectation (last5) was miscalculated in the test and corrected; 15 tests.
- T4 (12e6832): route delegated writer. RED: playoffs.test.ts failed on missing module; GREEN 79 total. 9 tests.
- T5 (737e6c9): route delegated writer. RED: repository.test.ts failed on missing module; GREEN 94 total (6 files). 15 tests.
- Assumptions: playoff auto-seeding also requires no unresolved tie inside the top 4 (seed order ambiguous); admin can assign semifinal teams manually and stored teams take precedence. Standings `unresolvedTie` only among teams with played > 0. `last5` is chronological (oldest first). Deleting a team referenced by matches fails on FK (no cascade).

- T6 (66992c7, 25533b7, 0aa2783, 4a2d13e, ebcfe49): route delegated writer, 5 work-unit commits. RED then GREEN per unit: migration 002 + winner triggers (8 failing schema tests), domain (10 failing: double round-robin, per-day slot minutes, time validation, semifinal winner validation, configurable points/tiebreakers), repository (10 failing), heroes, auth core (missing module), admin auth/users/tournaments/active tournament (missing module), config/rules/teams (16 failing), services (missing module), fixture/results/playoffs routes (30 failing). Total 244 tests in 19 files; `tsc --noEmit` clean. Smoke test with a temp DB: login page 200, unauthenticated /admin 303 to login, login POST sets HttpOnly SameSite=Lax cookie, POST without Origin 403, torneos/config/reglas/equipos/fixture/resultados/playoffs/usuarios all 200, server refuses to start without ADMIN_PASSWORD on an empty DB. Review findings folded in: winner triggers in 002 (NULL-team bypass), semifinal/final winner validation, addMinutes validation. Layout was not checked visually in a browser (CSS is the mockup's).
- T6 assumptions: migration 002 was edited in place to add `is_active` (unreleased, never applied outside tests); the first created tournament becomes active automatically; a tiebreak match is a normal group-phase match (its result counts in the standings); regenerating the fixture also deletes semifinal/final matches; playoff matches are created lazily (first result or manual pick) and store the bracket's teams at that moment; qualifiers stay fixed at 4 and BO3 / draws / 2-or-8 qualifiers were left out (not confirmed); tsx moved to dependencies so `npm start` works in production; 127 hero portraits (8.7 MB) committed under public/heroes; fonts still load from Google Fonts.

- T6.1 (c1..: 3d79f91 excluded) commits: security (limiter/proxy hop/413), validation and wording fixes (also un-ignored `src/data/` which `.gitignore` `data/` had hidden: heroes.ts/json were untracked), calendar and mobile nav CSS, then coordinator follow-ups: full-width admin, single control height (40/32px), one focus ring, compact hero slot, chip spacing, DD/MM/YYYY HH:mm:ss helper `src/format/datetime.ts`. Route: delegated writer. RED then GREEN per unit (CSS units were written before their presence tests).
- T7 route delegated writer: view model (`src/public/model.ts`), SSR views/routes, `public/site.css|js`, SSE (`/events`, `/t/:slug/events`, `/partial`), hero bg self-hosted (100 KB). Browser check with Playwright at 390 px: no horizontal overflow, hash tab + team filter work, live swap keeps tab and filter, live pill on.
- T8 route delegated writer: `npm run seed:oct2026`, idempotent, exact sheet fixture; test asserts 21 unique pairs, one bye per team and the schedule.
- Totals: 332 tests in 27 files, `tsc --noEmit` clean. Smoke on temp DB (PORT 3098): `/` 200 with name, `/t/torneo-oct-2026` 200, `/t/nope` 404, axe.png 200, public has no X-Frame-Options, `/admin/login` sends DENY + frame-ancestors none, SSE streams hello and a change after saving a result.

- T7.3 (fix(admin) cards/favicon commit and styled selects 6997110): tables become labelled cards under 760 px; public/admin standings show #, Equipo, PJ, Pts, K-D on phones; sidebar buttons equal; playoffs columns top-aligned; General card full width in 3 columns; team code shown once (input with colour accent); results date select autosubmits (Ver only in noscript); users form in one row; favicon.svg (+ /favicon.ico 204); selects use one custom chevron and `appearance: base-select` where supported.
- T7.1: migration 003 adds `tournaments.timezone` (default America/Lima, validated with Intl) and `matches.starts_at/ends_at` (ISO UTC), backfills from the old local columns (exact for Lima, UTC-5 all year) and DROPS `scheduled_date/start_time/end_time` so there is one source of truth. Repository converts wall-clock input in the tournament zone to UTC on write and derives `scheduledDate/startTime/endTime` on read, so admin code keeps working and shows tournament-zone values. `src/format/timezone.ts` (Intl only, DST-safe: gap moves forward, repeated hour takes the first). Public: server sends `data-start` ISO; `public/site-core.js` (pure, unit-tested) formats in the visitor zone, regroups days by the visitor's calendar day and rewrites the note "Horarios en tu hora local (zona)"; SSR fallback uses the tournament zone. "En juego"/"Siguiente" come from real instants (now vs starts_at). Seed sets America/Lima and yields UTC instants.
- T7.2: SSE caps 500 global / 10 per client (503 + Retry-After 30), one shared root listener, single cleanup path, named constants; `createLive` in site-core.js (capped exponential backoff with jitter, 0-500 ms refresh jitter, serialized fetches) with unit tests; limiter eviction keeps blocked keys; only fingerprinted asset URLs are immutable (others 1 day); heroes.json imported statically; `Object.hasOwn` in standings; slots may run past midnight (end earlier than start accepted when within 12 h).
- Totals after these: 401 tests in 34 files, `tsc --noEmit` clean.

- T7.4: migration 004 `tournaments.stream_url`. `src/domain/stream.ts` (pure, tested) parses Kick, Twitch (channel and `videos/<id>`, embedded as `video=v<id>`, which is what Twitch's player expects) and YouTube (watch, youtu.be, live, embed, `/channel/UC.../live`; `@handle` links are rejected with an explanation because they cannot be resolved without an API). The stored link is only ever used to rebuild the embed from validated parts. Admin: "Transmisión en vivo" card in Configuración (save, "Quitar stream" behind the confirm dialog, preview + detected platform). Public: "En vivo" tab second (`#envivo`), red dot on the tab only when a stream is set, placeholder otherwise. The player iframe is kept in place when a live refresh brings the same embed URL (checked in Chromium: the element survived a result update; clearing and setting a stream swapped it).
  - Twitch `parent`: `STREAM_PARENT_HOSTS` (comma-separated), default request host + `sites.google.com`. VERIFY AFTER DEPLOY that Twitch plays inside the Google Sites iframe; the framing host there may be a `*.googleusercontent.com` subdomain, which would have to be added to `STREAM_PARENT_HOSTS` (Twitch needs exact hosts).
  - No `frame-src`/CSP is sent on public pages, so the Kick, Twitch and YouTube players are not blocked. If a CSP is added later it must allow `player.kick.com`, `player.twitch.tv`, `www.youtube-nocookie.com`.
- T7.5: fixed a stray `}` in `admin.css` that dropped the sidebar footer rules (new brace-balance test fails on it; verified in Chromium that the footer is pinned and the dialog themed); seed runs in one `repo.transaction` and its CLI entry check uses file URLs (tested end to end with a child process); a refused SSE connection (HTTP error closes an EventSource for good) is retried with capped backoff, refused connections are not counted (EventSource cannot read `Retry-After`, so the cap equals it: 30 s); the page schedules a fragment refresh when the next slot starts or ends, so "En juego" / "Siguiente" follow the clock without a reload (verified: a round turned live with no reload); `localize` never throws and leaves server text when Intl, the zone or an instant is bad; one injected `Clock` (`src/clock.ts`) serves admin sessions and the public page.
- Known limitation from migration 003: matches with a date but no start time lose the date (the generator never creates them, and the edit form now requires a start time with a date).

- T7.6: "Quitar stream" (and its confirm dialog) shows whenever `stream_url` is non-null; a stored link that no longer parses shows "El link guardado ya no es válido" instead of a preview. `stream_url` capped at 300 chars (input `maxlength` and server-side Spanish error). The page carries `data-server-now`; the browser computes the offset once per render (`clockOffset`) and schedules "En juego"/"Siguiente" boundaries on server time (checked in Chromium with the visitor clock 2 h fast: the round still turned live at the right moment). The player-preserving patch is now `streamPatchMode` (pure, tested both ways): keep the iframe only when both panels have exactly one direct player with the same embed URL; otherwise just the stream panel is replaced (skeleton mismatch still replaces everything). Chromium: unrelated result update kept the same iframe node; changing the stream swapped only that panel and kept the selected tab.

## Next step
T9: Dockerfile + docker-compose (node:22-slim, SQLite volume, `TRUST_PROXY=1`, `COOKIE_SECURE=1`). The VPS already runs Caddy, so no Caddy in our compose; the Caddy site block needs no special SSE config (text/event-stream is flushed immediately). Nothing runs on the VPS without authorization.
