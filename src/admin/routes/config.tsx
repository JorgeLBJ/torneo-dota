import { Hono } from 'hono';
import type { Phase, ScheduleDay } from '../../db/repository.js';
import { isValidTime } from '../../domain/fixture.js';
import { describeStream, parentHostsFor } from '../../domain/stream.js';
import { requestHost } from '../../security.js';
import { isValidTimeZone } from '../../format/timezone.js';
import type { AdminEnv, Deps } from '../context.js';
import { isDate, positiveInt, readBody, str, strList, type Body } from '../form.js';
import { setFlash } from '../flash.js';
import { renderPage } from '../render.js';
import { checkName, checkSlug, fail, ok, type Checked } from '../validate.js';
import { ConfigView } from '../views/config.js';

const PHASES: Phase[] = ['group', 'semifinal', 'final'];

interface RawDay {
  phase: string;
  date: string;
  times: string;
  minutes: string;
}

function readRawDays(body: Body): RawDay[] {
  const phases = strList(body, 'day_phase');
  const dates = strList(body, 'day_date');
  const times = strList(body, 'day_times');
  const minutes = strList(body, 'day_minutes');
  return phases.map((phase, i) => ({
    phase: phase.trim(),
    date: (dates[i] ?? '').trim(),
    times: (times[i] ?? '').trim(),
    minutes: (minutes[i] ?? '').trim(),
  }));
}

function parseDay(raw: RawDay, position: number): Checked<ScheduleDay> {
  const label = `Día ${position}`;
  if (!PHASES.includes(raw.phase as Phase)) return fail(`${label}: elige una fase válida.`);
  if (!isDate(raw.date)) return fail(`${label}: la fecha no es válida.`);
  const times = raw.times.split(/[\s,;]+/).filter(Boolean);
  if (times.length === 0) return fail(`${label}: escribe al menos un horario (por ejemplo 14:00, 15:00).`);
  const badTime = times.find((t) => !isValidTime(t));
  if (badTime) return fail(`${label}: el horario "${badTime}" no es válido (usa HH:MM).`);
  if (new Set(times).size !== times.length) return fail(`${label}: hay un horario repetido.`);
  const minutes = positiveInt(raw.minutes);
  if (minutes === null || minutes > 600) return fail(`${label}: los minutos por partido deben ser un entero entre 1 y 600.`);
  return ok({ date: raw.date, phase: raw.phase as Phase, startTimes: times, slotMinutes: minutes });
}

const nextDay = (date: string): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export function configRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;

  app.get('/config', (c) => {
    const tournament = c.get('tournament');
    return renderPage(
      c,
      deps,
      { title: 'Configuración', active: 'config', tournament },
      <ConfigView
        tournament={tournament}
        days={repo.listScheduleDays(tournament.id)}
        stream={describeStream(tournament.streamUrl, parentHostsFor(requestHost(c, deps.config.trustProxy), deps.config.streamParentHosts))}
      />,
    );
  });

  app.post('/config', async (c) => {
    const tournament = c.get('tournament');
    const back = `/admin/t/${tournament.id}/config`;
    const body = await readBody(c);
    const error = (message: string) => {
      setFlash(c, 'error', message);
      return c.redirect(back, 303);
    };

    const name = checkName(str(body, 'name'));
    if (!name.ok) return error(name.error);
    const slug = checkSlug(repo, str(body, 'slug'), tournament.id);
    if (!slug.ok) return error(slug.error);
    const game = str(body, 'game');
    if (game.length < 1 || game.length > 60) return error('Escribe el juego del torneo (hasta 60 caracteres).');

    const timezone = str(body, 'timezone') || tournament.timezone;
    if (!isValidTimeZone(timezone)) return error('Elige una zona horaria válida (por ejemplo America/Lima).');

    const action = str(body, 'action');
    const removeAt = action.startsWith('remove:') ? Number(action.slice('remove:'.length)) : -1;
    const rows = readRawDays(body).filter((_, i) => i !== removeAt);
    const days: ScheduleDay[] = [];
    for (const [i, raw] of rows.entries()) {
      if (raw.date === '' && raw.times === '') continue; // fully blank row
      const parsed = parseDay(raw, i + 1);
      if (!parsed.ok) return error(parsed.error);
      days.push(parsed.value);
    }
    if (action === 'add') {
      const last = days.at(-1);
      days.push({
        phase: last?.phase ?? 'group',
        date: last ? nextDay(last.date) : new Date().toISOString().slice(0, 10),
        startTimes: last?.startTimes ?? ['14:00'],
        slotMinutes: last?.slotMinutes ?? 60,
      });
    }

    repo.updateTournament(tournament.id, { name: name.value, slug: slug.value, game, timezone });
    repo.replaceScheduleDays(tournament.id, days);
    deps.events.tournamentChanged(tournament.id);
    setFlash(c, 'ok', 'Configuración guardada.');
    return c.redirect(`/admin/t/${tournament.id}/config`, 303);
  });

  return app;
}
