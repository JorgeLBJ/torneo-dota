import { Hono, type Context } from 'hono';
import { summarizeGsiState } from '../../dota/gsi.js';
import { captureStateOf } from '../../gsi/state.js';
import type { AdminEnv, Deps } from '../context.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
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
    return renderPage(
      c,
      deps,
      { title: `Captura ${id}`, active: 'capturas' },
      <CaptureDetailView item={{ row, state: captureStateOf(row, deps.now()) }} summary={summarizeGsiState(parsed)} rawJson={rawJson} />,
    );
  });

  app.post('/capturas/:matchId/borrar', (c) => {
    const id = parseMatchId(c.req.param('matchId'));
    if (id === null || !repo.deleteGsiCapture(id)) setFlash(c, 'error', 'La captura no existe.');
    else setFlash(c, 'ok', `Captura ${id} borrada. El observador puede volver a enviar la partida.`);
    return c.redirect('/admin/capturas', 303);
  });

  return app;
}
