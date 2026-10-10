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
- [x] T2 Migration 014 `gsi_captures` + `POST /gsi` (token auth, 1 MB limit, rate limit, final-not-overwritten) + recent captures list on Observadores — route: delegated writer
- [x] T3 GSI capture → `DotaSnapshot` mapper (tolerant, non-final → `incomplete`) + `CapturedDotaSource` decorator checking captures before OpenDota, wired in `src/app.ts` — route: delegated writer. Revisit mapper with a real payload.

## Acceptance criteria
- An admin creates an observer "Juan" and downloads a `.cfg` whose `uri` is `<PUBLIC_BASE_URL>/gsi` and whose `auth.token` is the plaintext token; the plaintext is not retrievable later.
- `POST /gsi` with a valid token and `map.matchid` stores/updates the capture; missing/invalid/revoked token → 401; matchid absent or `"0"` → 200 without storing; after POST_GAME later posts do not overwrite.
- The Observadores screen lists observers (name, prefix, created, last seen, revoked) and recent captures.

## Progress / evidence
- T1 RED: `npx vitest run test/gsi-cfg.test.ts test/observer-tokens-repo.test.ts test/admin-observers.test.ts` -> 3 test files failed (6 tests; modules, repository methods and routes missing). Commit f0912ee.
- T1 GREEN: `npx vitest run` -> 1042 passed, 1 failed. The failure `public-routes.test.ts > matches tab > ... the next round ...` ('Siguiente') is clock-dependent (system date is after the fixture's 2026-10-03) and fails identically on the base without my changes (verified by stashing). `npm run typecheck` -> clean.
- T1 design: one-time reveal rendered straight from the POST response (no redirect/flash/DB copy, Cache-Control: no-store); the .cfg download is a client-side Blob built from the text on the page (public/admin.js), so no server URL can serve the plaintext again.
- T2 RED: `npx vitest run test/gsi-endpoint.test.ts` -> file failed to load (`src/gsi/routes.js` missing).
- T2 GREEN: `npx vitest run` -> 1068 passed, 1 failed (same pre-existing clock-dependent `public-routes` 'Siguiente' failure). `npm run typecheck` -> clean. user_version tests bumped to 14.
- T2 design: 1 MB `/gsi` body cap is selected in `createApp` next to the 64 KB/30 MB selectors; rate limit 300 posts/min per token id (after auth); final captures protected by `ON CONFLICT ... WHERE is_final = 0`.
- T2 commit: 332c930.
- T3 RED: `npx vitest run test/gsi-snapshot.test.ts` -> file failed to load (`src/dota/captured.js` missing).
- T3 GREEN: `npx vitest run` -> 1084 passed, 1 failed (same pre-existing clock-dependent `public-routes` 'Siguiente' failure). `npm run typecheck` -> clean.
- T3 design: `createApp` wraps whatever it would use before (`config.dotaSource ?? CachedDotaSource(OpenDotaSource)`) in `CapturedDotaSource`, so the test override still works and captures are checked first. Mapper `src/dota/gsi.ts` is validated only against the SYNTHETIC `test/fixtures/gsi-spectator-sample.json`; replace with a real POST_GAME capture and adjust. startTime approximated by first_received_at; bans order (draft keys) is best effort.
- Known leftovers: "Ver en OpenDota" links and the "datos de OpenDota" label remain for captured matches (private lobbies are not on OpenDota); would need a source marker in the stored snapshot.

- Parent spot check: `npm run typecheck` clean; `npx vitest run` 1084 passed / 1 failed (same clock-dependent `public-routes` 'Siguiente', pre-existing).
- Native review (range b10c500..ded9e38, risk high, consent granted): 4 lenses, approved, acknowledged (lineage review-f7f29dcfba68d4cf, authority burned). Reviewed boundary -> ded9e38.
- Advisory follow-ups (non-blocking): any active observer can lock a match id by posting a POST_GAME state first and finals are never overwritable (capture poisoning, no fix-forward) -> admin needs delete/reset of a capture; a non-final capture blocks the OpenDota fallback; JSON is parsed before auth (up to 1 MB unauthenticated); login limiter reused for throughput; observer name limit duplicated in view; garbled comment src/app.ts:44.
- Mockup (local, outside repo): `Desktop/mockup-gsi-observadores.html` (Observadores, Capturas GSI, Detalle + Vincular, Resultados). Screens 2-3 pending user approval as T4.

## Next step
- Capture a real spectator POST_GAME payload, replace the synthetic fixture and adjust `src/dota/gsi.ts`; decide on pushing / PR slicing (user).
