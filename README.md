# torneo-dota

A lightweight, multi-tournament web app for Dota 2 leagues. Set up a round-robin fixture, enter results in a backoffice, and let players follow **live standings, playoffs and a stream** on a public page that can be embedded in Google Sites.

![Public page: matches](docs/screenshots/public-matches.png)

## What you get

- **Fixture generator**: single or double round-robin for any number of teams, with one bye per round for odd counts. Manual edits: move matches, add rounds or matches, add a tiebreak match.
- **Results and standings**: admins record the winner and kills/deaths; the table is always derived from results (nothing is stored as points).
- **Playoffs**: top 4 qualify, semifinals 1st vs 4th and 2nd vs 3rd, final, champion.
- **Live public page** in a Dota 2 look (Spanish UI): Partidos, En vivo, Posiciones, Playoffs, Reglas. Updates without reloading.
- **Live stream tab**: one Kick, Twitch or YouTube link per tournament, embedded on the public page.
- **Multiple tournaments**: one is *active* and shown at `/`; every tournament also has its own URL for the archive.
- **Time zones**: match times are stored in UTC; visitors see their own local time.
- **Backoffice** (password login, several admins, all with the same role): tournaments, rules, teams with hero emblems (127 heroes, portraits self-hosted), fixture, results, playoffs, users.

## Screenshots

| Public, on a phone | Backoffice: results |
| --- | --- |
| ![Standings on a phone](docs/screenshots/public-standings-phone.png) | ![Admin results](docs/screenshots/admin-results.png) |

![Admin: hero picker](docs/screenshots/admin-hero-picker.png)

## Quick start

**Prerequisites:** Node.js 22 or newer and npm. It was developed and tested on Node 24; there is no `engines` field.

```bash
npm ci
npm run dev
```

Then open:

| URL | What |
| --- | --- |
| <http://localhost:3000/> | Public page of the active tournament ("Próximamente" until one is active) |
| <http://localhost:3000/admin> | Backoffice. On a fresh database it sends you to the first-run setup |

**First run: create the first admin.** Pick one:

| Way | How |
| --- | --- |
| Setup page (default) | Start the server. It prints `Setup required: open /admin/setup and use code: <code>`. Open `/admin/setup`, enter a username, a password (8 to 200 characters, confirmed) and that code |
| `ADMIN_PASSWORD` | Start with `ADMIN_PASSWORD='choose-a-password' npm run dev`: the admin `admin` is created at startup and setup is never shown |

- The generated setup code is random (192 bits), printed **once** in the server output, and different on every start. To use your own, set `ADMIN_SETUP_TOKEN`.
- `/admin/setup` exists only while there are no admins; afterwards it returns 404. Attempts are rate-limited like the login.
- Afterwards manage users in the backoffice (**Usuarios**). Each admin can change their own password from the sidebar (**Cambiar contraseña**), which also signs out their other sessions.
- The SQLite database is created at `./data/torneos.db` on first run and migrated automatically.
- Optional demo data: `npm run seed:oct2026` creates *Torneo All vs All · Oct 2026* (7 teams, 21 matches) and makes it active. It is safe to run twice (it does nothing if the tournament exists).

New tournament checklist (in the backoffice):

- [ ] **Torneos**: create the tournament and mark it active
- [ ] **Configuración**: name, slug, game, time zone, calendar days and start times
- [ ] **Reglas**: points, tiebreakers, format (single/double round-robin), rulebook text
- [ ] **Equipos**: add teams and pick a hero emblem for each
- [ ] **Fixture**: generate, then adjust by hand if needed
- [ ] **Resultados**: enter results as matches finish

## Configuration

The server reads these environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATABASE_PATH` | `./data/torneos.db` | SQLite file (its folder is created if missing) |
| `ADMIN_PASSWORD` | none | Optional. If set and there are no admins, creates the admin `admin` with this password at startup. Without it, the first admin is created on `/admin/setup` |
| `ADMIN_SETUP_TOKEN` | random per start | Code required by `/admin/setup`. If unset, a random one is generated and printed once at startup (see the server output; with Docker, the container logs) |
| `COOKIE_SECURE` | off | `1` or `true`: mark the session cookie `Secure`. Set it when served over HTTPS |
| `TRUST_PROXY` | off | `1` or `true`: trust `X-Forwarded-For` / `X-Forwarded-Host` from a reverse proxy (see below) |
| `STREAM_PARENT_HOSTS` | empty | Comma-separated hosts allowed to frame the Twitch player. Empty means the request host plus `sites.google.com` |

`TRUST_PROXY` assumes **exactly one** trusted proxy in front (for example Caddy on the same host). The login rate limiter then keys on the right-most `X-Forwarded-For` entry, the one the proxy appended.

## How it works

### Routes

| Route | Description |
| --- | --- |
| `/` | Public page of the active tournament |
| `/t/:slug` | Public page of any tournament (archive); Spanish 404 if unknown |
| `/partial`, `/t/:slug/partial` | The page content as an HTML fragment (used for live refresh) |
| `/events`, `/t/:slug/events` | Server-sent events stream (`hello`, `change`, `ping`) |
| `/admin` | Backoffice: opens the active tournament's results |
| `/admin/setup` | First-run setup (only while there are no admins; otherwise 404) |
| `/admin/cuenta` | Change your own password |
| `/admin/torneos`, `/admin/usuarios` | Tournaments list, admin users |
| `/admin/t/:id/{config,reglas,equipos,fixture,resultados,playoffs}` | Per-tournament screens |
| `/assets/*` | CSS, JS, images and hero portraits |

Public pages send no framing headers, so they render inside a Google Sites iframe. The backoffice sends `X-Frame-Options: DENY` and `frame-ancestors 'none'`.

### Rules

- Points per win/loss are configurable per tournament (default **win 1, loss 0**; no draws).
- Ranking: points, then the configured tiebreakers, by default **kill difference (K−D)** then **total kills**. A tie that remains is flagged as unresolved; resolve it with a tiebreak match (admin: Fixture) or by choosing the semifinal teams by hand.
- **Top 4** advance. Semifinals: 1st vs 4th and 2nd vs 3rd. The winners meet in the final.
- While the group stage is running, the Playoffs tab shows a *projection* from the current table.

### Time zones

| Where | Behaviour |
| --- | --- |
| Storage | Match start and end are ISO UTC instants |
| Backoffice | Inputs and labels are in the **tournament's time zone** (default `America/Lima`, editable in Configuración) |
| Public page | Times and day headings use the **visitor's** zone, with a note such as "Horarios en tu hora local (Europe/Madrid)". Without JavaScript the server shows the tournament zone |

Changing a tournament's zone keeps existing matches at the same instant; only how they are read changes. "En juego" and "Siguiente" are computed from real instants.

### Real time

- Saving in the backoffice emits an in-process event. Connected public pages receive `change` over SSE, re-fetch `/partial` and swap it in, keeping the selected tab and team filter.
- A heartbeat is sent every 25 s. Connections are capped (500 total, 10 per client; more get `503`). The client reconnects with capped exponential backoff.
- **Run a single instance.** Events live in memory, so a second Node process would not notify the first one's visitors.

### Live stream

Set the link in **Configuración > Transmisión en vivo**. The public "En vivo" tab embeds it (a red dot marks the tab while a stream is set).

| Platform | Accepted links |
| --- | --- |
| Kick | `kick.com/<channel>` |
| Twitch | `twitch.tv/<channel>`, `twitch.tv/videos/<id>` |
| YouTube | `watch?v=`, `youtu.be/`, `/live/<id>`, `/embed/<id>`, `/channel/UC…/live` (`@handle` links cannot be embedded) |

- Only `https` links are accepted; the embed URL is rebuilt from the validated parts, never from the raw input.
- **Twitch parent hosts:** Twitch only plays in pages whose host it was told about. By default this app passes the request host and `sites.google.com`. If Twitch does not play inside your Google Sites page, the framing host may be a `*.googleusercontent.com` subdomain: add it to `STREAM_PARENT_HOSTS`.
- **Ad blockers** can block embedded players. The tab tells visitors to disable theirs or open the channel page.
- Twitch documents a minimum player size of 400×300 px. The frame is a responsive 16:9, so on very narrow phones it can be smaller than that.

## Architecture

**Stack:** Node.js + TypeScript, [Hono](https://hono.dev) with `hono/jsx` server-side rendering, `better-sqlite3` (SQL, no ORM), vanilla JS on the client (no build step), Vitest. `tsx` runs the TypeScript directly, in development and in `npm start`.

```text
src/
  server.ts, app.ts   entry point and app wiring
  config.ts, clock.ts environment flags, injectable clock
  db/                 migrations runner, connection, repository (all SQL lives here)
  domain/             pure logic: fixture, standings, playoffs, stream links
  services/           use cases combining repository and domain
  admin/              backoffice routes and views
  public/             public model (view data), routes, views, SSE
  auth/               passwords, sessions, login rate limiter
  format/             date formatting and time zone arithmetic
  data/               hero list
migrations/           forward-only SQL files: 001_init.sql ... 004_stream.sql
public/               static files: CSS, client JS, hero portraits, images
scripts/              seed and hero-portrait downloader
test/                 Vitest tests (in-memory SQLite)
odd/                  feature plan, mockups and review log
docs/screenshots/     images used in this README
```

**Migrations:** `migrations/NNN_name.sql` files are applied in order at startup, one transaction each, and the version is kept in `PRAGMA user_version`. The app refuses to start if one fails. They are forward-only: **never edit a migration that has been applied**; add a new file instead.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Start with file watching (`tsx watch`) |
| `npm start` | Start without watching |
| `npm test` | Run all tests once (`vitest run`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed:oct2026` | Seed the October 2026 tournament (idempotent) |
| `npm run fetch:heroes` | Download missing hero portraits into `public/heroes/` (they are already committed; use `-- --force` to refetch) |

- **TDD:** write the failing test first, then the code. Route tests use `app.request()` against an in-memory database.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, ...), one reviewable change each, with its tests.
- Test runners are capped at two workers on purpose (`VITEST_MAX_WORKERS`); do not raise it on a shared machine.

## Deployment

**Docker deployment: coming soon**, behind an existing Caddy reverse proxy. This repository does not contain Docker files yet. Once it does, the first-run setup code will be in the container logs (`docker compose logs`); alternatively set `ADMIN_PASSWORD` or `ADMIN_SETUP_TOKEN` in the environment.

Settings needed behind a proxy that terminates HTTPS:

| Setting | Why |
| --- | --- |
| `COOKIE_SECURE=1` | Session cookie is only sent over HTTPS |
| `TRUST_PROXY=1` | Correct client address for the login rate limit and the right host for Twitch |
| `DATABASE_PATH` on a persistent volume | The SQLite file is the only state |

**Backups:** everything is in the SQLite file. The database runs in WAL mode, so copy `torneos.db` together with `torneos.db-wal` and `torneos.db-shm` while the app is stopped, or take a consistent copy of a running database with SQLite's backup API (with the `sqlite3` command-line tool: `sqlite3 torneos.db ".backup backup.db"`).

## Credits and legal

Built by **jpsolutions**: <https://jpsolutions.app>

Dota 2 and hero artwork are trademarks and copyright of Valve Corporation. This project is not affiliated with or endorsed by Valve.

License: TBD.
