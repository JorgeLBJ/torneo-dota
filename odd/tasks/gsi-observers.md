# Feature: gsi-observers

## Objective
Capture tournament games ourselves through Dota 2 Game State Integration (GSI): collaborating observers spectate each lobby with a pre-configured `.cfg`, the Dota client POSTs the game state to our `/gsi` endpoint, and we keep the final state per Dota match id.

## Problem / Why
Tournament games are private lobbies. Valve's `GetMatchDetails` answers `500 {}` for them and OpenDota answers `404`, so the existing "Importar desde Dota" lookup cannot find them. Only matches we observe matter; external data is not needed.

## Scope
- Admin "Observadores" screen (global, like Usuarios): create a named observer token, list, revoke, download a ready `gamestate_integration_torneo.cfg` with the production `uri` and the token.
- Public `POST /gsi`: authenticate `auth.token`, store the latest state per Dota match id, never overwrite a capture once it reached `DOTA_GAMERULES_STATE_POST_GAME`.
- Admin list of recent captures (match id, observer, state, final, last update) to verify observers work.
- Lookup chain: the admin "Buscar / Autocompletar" checks our captures first and only then OpenDota (user request 2026-10-09). The GSI→`DotaSnapshot` mapper follows the documented spectator payload shape (`player.team2/team3.playerN`, `hero.*`, `map.win_team/radiant_score/dire_score/clock_time`, `draft`) and is tolerant of missing fields; adjust it once a real capture is available.

## Constraints
- Same as tournament-app: Hono + JSX SSR, better-sqlite3, no ORM, all SQL in `src/db/repository.ts`, forward-only migrations (next: 013), vanilla client JS, UI copy in Spanish, code/commits in English.
- Tokens: `randomBytes` plaintext shown/downloadable only right after creation; DB stores SHA-256 hash + short display prefix (pattern of `src/auth/session.ts`). Revoked tokens are rejected.
- `/gsi` is outside `/admin` (no `sameOriginGuard`), has its own body limit (1 MB) instead of the global 64 KB, and is rate limited per token.
- Raw payload stored as JSON text; `auth` block stripped before storing.
- Nothing runs on the VPS without explicit user authorization.

## TDD
- Mode: Strict TDD (source: user global config). Runner: Vitest (`npx vitest run`), plus `npm run typecheck`.

## Delivery
- Strategy: ask-on-risk. Forecast ~900 authored lines across T1–T3 (tests included).

## Tasks
- [x] T1 Migration 013 `observer_tokens` + repository + admin "Observadores" screen (create / list / revoke / one-time `.cfg` download) — route: delegated writer (2+ non-trivial files)
- [ ] T2 Migration 014 `gsi_captures` + `POST /gsi` (token auth, 1 MB limit, rate limit, final-not-overwritten) + recent captures list on Observadores — route: delegated writer
- [ ] T3 GSI capture → `DotaSnapshot` mapper (tolerant, non-final → `incomplete`) + `CapturedDotaSource` decorator checking captures before OpenDota, wired in `src/app.ts` — route: delegated writer. Revisit mapper with a real payload.

## Acceptance criteria
- An admin creates an observer "Juan" and downloads a `.cfg` whose `uri` is `<PUBLIC_BASE_URL>/gsi` and whose `auth.token` is the plaintext token; the plaintext is not retrievable later.
- `POST /gsi` with a valid token and `map.matchid` stores/updates the capture; missing/invalid/revoked token → 401; matchid absent or `"0"` → 200 without storing; after POST_GAME later posts do not overwrite.
- The Observadores screen lists observers (name, prefix, created, last seen, revoked) and recent captures.

## Progress / evidence
- T1 RED: `npx vitest run test/gsi-cfg.test.ts test/observer-tokens-repo.test.ts test/admin-observers.test.ts` -> 3 files / 6 failed files-level (modules and routes missing).
- T1 GREEN: `npx vitest run` -> 1042 passed, 1 failed. The failure `public-routes.test.ts > matches tab > ... the next round ...` ('Siguiente') is clock-dependent (system date is after the fixture's 2026-10-03) and fails identically on the base without my changes (verified by stashing). `npm run typecheck` -> clean.
- T1 design: one-time reveal rendered straight from the POST response (no redirect/flash/DB copy, Cache-Control: no-store); the .cfg download is a client-side Blob built from the text on the page (public/admin.js), so no server URL can serve the plaintext again.

## Next step
- T2.
