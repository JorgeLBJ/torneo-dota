import { Hono, type Context } from 'hono';
import type { Match, Team, Tournament } from '../../db/repository.js';
import { resolveSeries, seriesLengthFor } from '../../domain/series.js';
import { snapshotFromCapture } from '../../dota/captured.js';
import { summarizeGsiState } from '../../dota/gsi.js';
import { DotaLookupError } from '../../dota/source.js';
import { captureStateOf } from '../../gsi/state.js';
import { linkSnapshotToGame } from '../../services/games.js';
import type { AdminEnv, Deps } from '../context.js';
import { parseGameNumber } from '../game-form.js';
import { readBody, str } from '../form.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { LinkForm, matchOptionLabel, type LinkFormProps } from '../views/capture-link.js';
import { CaptureDetailView, CapturesView, FILTERS, PAGE_SIZE, type CaptureFilter, type CaptureItem } from '../views/captures.js';

/** How many of the most recently updated captures the list works on. */
const MAX_LISTED = 1000;

const parseMatchId = (value: string): number | null => (/^\d{1,15}$/.test(value) ? Number(value) : null);

export function captureRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;

  app.get('/capturas', (c) => {
    const query = (c.req.query('q') ?? '').trim().slice(0, 20);
    const requested = c.req.query('estado');
    const filter: CaptureFilter = FILTERS.find((f) => f.key === requested)?.key ?? 'todas';
    const now = deps.now();
    const items: CaptureItem[] = repo
      .listGsiCaptureRows(MAX_LISTED)
      .map((row) => ({ row, state: captureStateOf(row, now) }))
      .filter(({ row }) => query === '' || String(row.dotaMatchId).includes(query));
    const matches: Record<CaptureFilter, (i: CaptureItem) => boolean> = {
      todas: () => true,
      'en-curso': (i) => i.state === 'live',
      'sin-vincular': (i) => i.state === 'final' && i.row.link === null,
      vinculadas: (i) => i.row.link !== null,
    };
    const counts = Object.fromEntries(FILTERS.map((f) => [f.key, items.filter(matches[f.key]).length])) as Record<CaptureFilter, number>;
    const shown = items.filter(matches[filter]);
    const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    const page = Math.min(pages, Math.max(1, Number(c.req.query('pagina')) || 1));
    return renderPage(
      c,
      deps,
      { title: 'Capturas GSI', active: 'capturas' },
      <CapturesView items={shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)} counts={counts} filter={filter} query={query} page={page} pages={pages} />,
    );
  });

  const intOrNull = (value: string | undefined): number | null => (value !== undefined && /^\d{1,15}$/.test(value) ? Number(value) : null);

  /** Everything the two-step link form needs, from the query string (tournament, match, and the picks kept for the confirmation). */
  function linkFormProps(captureId: number, query: Record<string, string>): LinkFormProps {
    const tournaments = repo.listTournaments();
    const requested = intOrNull(query.torneo);
    const tournament: Tournament | undefined =
      tournaments.find((t) => t.id === requested) ?? tournaments.find((t) => t.isActive) ?? tournaments[0];
    const teams = new Map<number, Team>(tournament ? repo.listTeams(tournament.id).map((t) => [t.id, t]) : []);
    const playable: Match[] = tournament ? repo.listMatches(tournament.id).filter((m) => m.team1Id !== null && m.team2Id !== null) : [];
    const match = playable.find((m) => m.id === intOrNull(query.partido));
    const pair: [Team, Team] | null = match ? [teams.get(match.team1Id!)!, teams.get(match.team2Id!)!] : null;
    let slots: LinkFormProps['slots'] = [];
    if (tournament && match) {
      const games = repo.listGames(match.id);
      const length = seriesLengthFor(tournament, match.phase, match.isTiebreak);
      const next = resolveSeries(match.team1Id!, match.team2Id!, length, games).nextGame;
      const saved = new Set(games.map((g) => g.gameNumber));
      for (let n = 1; n <= length; n++) if (saved.has(n) || n === next) slots.push({ number: n, hasResult: saved.has(n) });
    }
    const game = parseGameNumber(query.juego);
    return {
      captureId,
      tournaments,
      tournamentId: tournament?.id ?? null,
      matches: playable.map((m) => ({ match: m, label: matchOptionLabel(m, teams) })),
      matchId: match?.id ?? null,
      teams: pair,
      slots,
      chosen: { game, radiant: intOrNull(query.radiant) },
      confirm: query.confirmar === 'pedir' && game !== null && slots.some((s) => s.number === game && s.hasResult),
    };
  }

  const notFound = (c: Context<AdminEnv>) =>
    renderPage(
      c,
      deps,
      { title: 'Capturas GSI', active: 'capturas', status: 404 },
      <>
        <p>
          <a href="/admin/capturas">← Capturas GSI</a>
        </p>
        <h1>Captura no encontrada</h1>
        <p class="sub">Esa captura no existe o fue borrada.</p>
      </>,
    );

  app.get('/capturas/:matchId', (c) => {
    const id = parseMatchId(c.req.param('matchId'));
    const row = id === null ? undefined : repo.getGsiCaptureRow(id);
    const capture = id === null ? undefined : repo.getGsiCapture(id);
    if (!row || !capture) return notFound(c);
    let parsed: unknown = null;
    let rawJson = capture.stateJson;
    try {
      parsed = JSON.parse(capture.stateJson);
      rawJson = JSON.stringify(parsed, null, 2);
    } catch {
      // Shown as stored.
    }
    const state = captureStateOf(row, deps.now());
    let linkSection: unknown = null;
    if (state === 'final' && row.link === null) {
      try {
        snapshotFromCapture(capture); // only a capture that can become a game is offered for linking
        linkSection = <LinkForm {...linkFormProps(id!, c.req.query())} />;
      } catch (error) {
        if (!(error instanceof DotaLookupError)) throw error;
        linkSection = (
          <div class="note" role="status">
            Esta captura no se puede vincular: {error.message}
          </div>
        );
      }
    }
    return renderPage(
      c,
      deps,
      { title: `Captura ${id}`, active: 'capturas' },
      <CaptureDetailView item={{ row, state }} summary={summarizeGsiState(parsed)} rawJson={rawJson}>
        {linkSection as never}
      </CaptureDetailView>,
    );
  });

  app.post('/capturas/:matchId/borrar', (c) => {
    const id = parseMatchId(c.req.param('matchId'));
    if (id === null || !repo.deleteGsiCapture(id)) setFlash(c, 'error', 'La captura no existe.');
    else setFlash(c, 'ok', `Captura ${id} borrada. El observador puede volver a enviar la partida.`);
    return c.redirect('/admin/capturas', 303);
  });

  app.post('/capturas/:matchId/vincular', async (c) => {
    const id = parseMatchId(c.req.param('matchId'));
    const capture = id === null ? undefined : repo.getGsiCapture(id);
    if (id === null || !capture) {
      setFlash(c, 'error', 'La captura no existe.');
      return c.redirect('/admin/capturas', 303);
    }
    const body = await readBody(c);
    const back = (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams({ torneo: str(body, 'torneo'), partido: str(body, 'partido'), juego: str(body, 'juego'), radiant: str(body, 'radiant'), ...extra });
      return c.redirect(`/admin/capturas/${id}?${params.toString()}`, 303);
    };
    const refuse = (message: string) => {
      setFlash(c, 'error', message);
      return back();
    };

    if ((repo.getGsiCaptureRow(id)?.link ?? null) !== null) return refuse('Esta captura ya está vinculada a un juego.');
    let snapshot;
    try {
      snapshot = snapshotFromCapture(capture);
    } catch (error) {
      if (error instanceof DotaLookupError) return refuse(error.message);
      throw error;
    }
    const tournament = repo.getTournamentById(intOrNull(str(body, 'torneo')) ?? -1);
    if (!tournament) return refuse('Elige un torneo.');
    const match = repo.getMatch(intOrNull(str(body, 'partido')) ?? -1);
    if (!match || match.tournamentId !== tournament.id || match.team1Id === null || match.team2Id === null) {
      return refuse('Elige un partido del torneo con los dos equipos definidos.');
    }
    const gameNumber = parseGameNumber(str(body, 'juego'));
    if (gameNumber === null) return refuse('Elige el juego de la serie.');
    const radiant = intOrNull(str(body, 'radiant'));
    if (radiant === null) return refuse('Elige quién jugó de Radiant.');

    if (repo.listGames(match.id).some((g) => g.gameNumber === gameNumber) && str(body, 'confirmar') !== '1') {
      return back({ confirmar: 'pedir' });
    }
    const saved = linkSnapshotToGame(repo, tournament, match, gameNumber, snapshot, radiant);
    if (!saved.ok) return refuse(saved.error);
    deps.events.tournamentChanged(tournament.id);
    setFlash(c, 'ok', `Captura vinculada: juego ${gameNumber} del partido ${match.matchNumber} de «${tournament.name}» guardado.`);
    return c.redirect(`/admin/capturas/${id}`, 303);
  });

  return app;
}
