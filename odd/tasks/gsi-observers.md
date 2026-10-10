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

- [x] T4 "Capturas GSI" global admin screen (user-approved mockup `Desktop/mockup-gsi-observadores.html`, screens 2–3): list with Match ID search + filters (Todas / En curso / Sin vincular / Vinculadas) and states En curso / Finalizada / Incompleta (non-final and no update for a while); detail page (score, duration, observer, 10 players per side from the mapper, raw JSON collapsed); delete/reset a capture (fixes capture poisoning / no fix-forward advisories); move "Capturas recientes" off Observadores and add a per-observer captures count; nav item with "N sin vincular" badge — route: delegated writer
- [x] T5 "Vincular a un juego del torneo" from the capture detail (tournament → match → game slot, who played Radiant; saves winner, K/D and snapshot through the existing games service, confirm before overwriting a saved game) + source marker in the stored snapshot so captured games stop showing "Ver en OpenDota" / "datos de OpenDota" — route: delegated writer

- [x] T6 One-click observer installer: "Descargar instalador (.bat)" as the primary action on the one-time token panel (client-side Blob, like the .cfg; .cfg + manual steps stay as fallback). The .bat (CRLF, embedded PowerShell) finds Steam via registry, Dota 2 (app 570) via `steamapps/libraryfolders.vdf` across libraries, creates `game/dota/cfg/gamestate_integration/`, writes `gamestate_integration_torneo.cfg` (replacing a previous one), creates a Desktop shortcut "Dota 2 (Torneo)" running `steam.exe -applaunch 570 -gamestateintegration`, optionally launches it; never edits Steam's localconfig.vdf. Instructions mention the SmartScreen prompt. User-approved 2026-10-10 — route: delegated writer

- [x] T7 Remove "Vincular a un juego del torneo" from the Capturas GSI detail (user decision 2026-10-10: linking stays in Resultados via Match ID + Buscar, which checks our captures then OpenDota). The detail only shows match data. Keep: read-only "Vinculada a" info, filters/badge (derived from match_games.dota_match_id), the snapshot source marker, delete capture. Remove the link route/view/service/tests that only served the linking UI; list action reads "Ver" — route: delegated writer

- [x] T8 Live Capturas GSI (user-approved 2026-10-10): `/gsi` emits a captures-changed event on the in-process bus (`src/events.ts`); authenticated admin SSE endpoint `/admin/capturas/eventos`; list and detail pages subscribe and refresh their content in place (fetch + swap, keep open <details>, update the nav badge), throttled to at most one refresh every ~3 s — route: delegated writer

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

- T4 RED: `npx vitest run test/admin-captures.test.ts` -> file failed to load (`src/gsi/state.js` missing); `gsi-snapshot` expectations for `netWorth` / `summarizeGsiState` added first. GREEN: `npx vitest run` -> 1102 passed, 1 failed (same pre-existing clock-dependent `public-routes` 'Siguiente'). `npm run typecheck` clean. Commit 48439b1.
- T4 design: `/admin/capturas` list reads score/duration/winner with `json_extract` in SQL (no payload loaded), newest 1000 rows, 50 per page; state is derived: final = `is_final`, En curso = non-final updated within `INCOMPLETE_AFTER_MS` (5 min, `src/gsi/state.ts`, tested with the injected clock), otherwise Incompleta. Chips/search are GET links; counts follow the search. Detail uses the new tolerant `summarizeGsiState` (mapper output gains optional `netWorth`). Delete is `POST /admin/capturas/:id/borrar` with the dialog; it never touches `match_games`. `listRecentGsiCaptures` removed; Observadores shows a per-observer count.
- T5 RED: `npx vitest run test/admin-capture-link.test.ts` -> 15 of 16 failed (no link form, route or source marker). GREEN: `npx vitest run` -> 1118 passed, 1 failed (same pre-existing 'Siguiente'). `npm run typecheck` clean. Commit 5cc7a42.
- T5 design: GET-driven step form (torneo + partido reload the page via `data-autosubmit`; then a POST form with juego + Radiant team). Slots offered = games that already have a result plus the next free one from `resolveSeries`. `linkSnapshotToGame` (services/games.ts) builds the result with `gameFromSnapshot` and saves through `saveGameResult`, so validation is shared with the Dota import. Overwriting a saved game: first POST redirects to `?confirmar=pedir`, second POST carries `confirmar=1`. A capture already used by a game is not offered again (clear the game in Resultados first). Source marker: optional `source: 'opendota' | 'gsi'` in the stored snapshot (absent = OpenDota); `Game.dotaSource` is read with `json_extract` so tournament-wide queries still skip the snapshot; admin results card and `public/match-detail.js` show "Capturado por nuestros observadores" / "Datos capturados por nuestros observadores" with no OpenDota link for 'gsi'.
- Open risks: `json_extract` on every game snapshot in the tournament query; no migration index on `match_games.dota_match_id`; mapper still validated only against the synthetic fixture; an observer that keeps sending after a delete recreates the capture (non-final first).

- Parent spot check T4-T5: `npm run typecheck` clean; `npx vitest run` 1118 passed / 1 failed (pre-existing clock-dependent 'Siguiente').
- Native review T4-T5 (range ded9e38..5f3181c, medium, slice budget reached, consent granted): 1 lens (reliability), approved, acknowledged (lineage review-461eacf8919619b4). Reviewed boundary -> 5f3181c.
- Advisory follow-ups T4-T5 (non-blocking): overwrite confirmation (`confirmar=1`) is not bound to the specific game slot (src/admin/routes/captures.tsx:182); nav badge window vs list window may differ; GROUP BY link lookup nondeterministic if one match id is linked twice. Screens not checked in a browser yet.

- Visual check 2026-10-10 (local server :3417, scratch DB, synthetic captures via POST /gsi): Observadores (token + cfg + count), Capturas GSI (filters, badge), Detalle, Vincular step form (auto-submit on change) and Resultados card ('Capturado por nuestros observadores') render and work end to end. Nits: the card summary still reads 'Importado de Dota' for GSI games.

- T6 RED: `npx vitest run test/gsi-installer.test.ts test/admin-observers.test.ts` -> installer module missing (file failed to load) and the panel test failed (no installer button). GREEN: same files 15 passed; `npx vitest run` -> 1126 passed, 1 failed (same pre-existing clock-dependent `public-routes` 'Siguiente'); `npm run typecheck` clean. Commit 1fdc344.
- T6 design: `src/gsi/installer.ts` `buildInstallerBat(cfg)` (CRLF, cmd prologue reads `%~f0` after a split marker and runs PowerShell `-NoProfile -ExecutionPolicy Bypass`; throws on a here-string terminator). The panel renders the .bat text in a hidden-by-details `<pre id="installerText">` and `public/admin.js` downloads it as a client-side Blob (re-adding CRLF, since the HTML parser normalizes them); filename `instalar-observador-torneo-<slug>.bat`. .cfg + manual steps moved into a "Instalación manual" details.
- T6 real-script check (scratch fake Steam: root + 2nd library holding Dota, env overrides, no prompt): found Steam, found Dota in the 2nd library, cfg written there (no BOM), .lnk created (target steam.exe, args `-applaunch 570 -gamestateintegration`), exit 0; second run reported "se reemplazó la anterior"; fake root without Dota -> clear Spanish error, exit 1. Real Steam, Desktop and Dota were never touched.
- Risks T6: SmartScreen / antivirus may flag a downloaded .bat that runs PowerShell (documented in panel copy); libraryfolders.vdf variants beyond "path" entries are not parsed (Steam root is always tried too); the installer is not tested on a real observer machine yet.

- T6 parent spot check: typecheck clean; vitest 1126 passed / 1 failed (pre-existing 'Siguiente'); generated installer read back (ASCII batch prologue, UTF-8 PS body, cfg embedded verbatim). Review assess (base 5f3181c, committed-only): medium, review_due=false, under_budget -> pending in the slice until a later commit reaches the budget.

- T6 native review (base 5f3181c, medium, granted): reliability lens found a BLOCKER — public/admin.js had raw CR/LF inside a regex/string (writer escaping slip), so the whole admin script failed to parse; vitest never loaded it. One bounded correction d7d9efa: escaped the CR/LF regex and its replacement string (backslash escapes instead of raw line breaks) + new test/client-scripts-syntax.test.ts compiling every public/*.js (RED observed on admin.js). Targeted validation approved, acknowledged (lineage review-2f2055b565ee11fd).
- Advisory from that review, fixed in 578844e: manual-install path lost its backslashes in the view (RED test then GREEN). Other advisory: no client-side test for the Blob download. 578844e assess: medium, under_budget (pending in slice).
- Checks after fixes: vitest 1131 passed / 1 failed (pre-existing 'Siguiente'); typecheck clean.

- REAL capture 2026-10-10 (user, Windows, installer .bat applied, Dota opened from the 'Dota 2 (Torneo)' shortcut, watching a REPLAY of public match 9037383577): GSI posts arrived at local :3417, capture stored and marked final at POST_GAME (state ~57 KB). Real shape matches the assumed one (map.matchid/win_team/radiant_score/dire_score/clock_time, player.team2/team3.playerN with name/kills/deaths/assists/last_hits/denies/gpm/xpm/net_worth/hero_damage, hero.*.playerN with name npc_dota_hero_*/level). mapGsiState on it: radiantWin true, 41-35, 3280 s, 10 players with heroes, nicks, KDA, GPM/XPM, damage, net worth. draft was {} (replay) -> bans []. Conclusion: replays work as an observer fallback.
- Follow-up: replace the synthetic fixture with a SANITIZED version of this real capture (strip steamid/accountid, rename nicks) and pin the mapper on it.

- Hero portraits on the capture detail (376b4dc, RED test then GREEN) and aligned Radiant/Dire columns (53df141); checked in the browser on the real capture 9037383577. User asked to keep the read-only 'Vinculada a' (kept).
- Native review T7 + portraits (base 578844e, medium, slice budget, granted): approved, acknowledged (lineage review-dc3c00e141c71cec). Advisory: the Resultados hint shows on a final capture even when the mapper cannot convert it (src/admin/views/captures.tsx:269-273).

## Next step
- Capture a real spectator POST_GAME payload, replace the synthetic fixture and adjust `src/dota/gsi.ts`; decide on pushing / PR slicing (user).

- T7 RED: `npx vitest run test/admin-captures.test.ts` -> 2 failed (list still "Ver y vincular"; detail still had the link form, no Resultados hint). GREEN: `npx vitest run` -> 1123 passed, 1 failed (same pre-existing clock-dependent `public-routes` 'Siguiente'); `npm run typecheck` clean; `node --check public/admin.js` ok. Commit 85cdc13.
- T7 removed: `src/admin/views/capture-link.tsx`, `test/admin-capture-link.test.ts`, POST `/capturas/:matchId/vincular`, tournament/match query handling, `linkSnapshotToGame`. No repository method was link-only; `public/admin.js` had no link JS. Source-marker tests moved to `test/admin-captures.test.ts`; added a test that the Resultados flow (dota buscar/autocompletar + save) stores a game with source 'gsi' and the capture then shows as Vinculada. Detail now shows "Para cargarla en un juego, escribe este Match ID en Resultados y pulsa «Buscar»." for unlinked final captures.

- T8 RED: `npx vitest run test/admin-captures-live.test.ts test/admin-live-core.test.ts` -> 10 tests failed (bus methods, SSE route, hooks missing) and the core file missing. GREEN: `npx vitest run` -> 1143 passed, 1 failed (same pre-existing clock-dependent 'Siguiente'); `npm run typecheck` clean; `node --check public/admin.js` ok. Commit ce6b69a.
- T8 design: `captures:changed` on the bus, emitted by POST /gsi only when the upsert wrote, on capture delete and on game save/clear (results and playoffs). SSE `/admin/capturas/eventos` (hello/change/ping, retry 3 s). Client: leading+trailing throttle (3 s, pure `public/admin-live-core.js`), fetch of the current URL, per-child swap of `[data-live-region]` (child holding the focused field is kept, open <details> restored, skipped while a dialog is open), nav badge via `data-live-nav`, new rows (`data-capture-key`) get a calm `cap-new` animation (disabled under reduced motion). Detail 404 shows the not-found content and closes the stream.
