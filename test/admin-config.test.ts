import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tournament } from '../src/db/repository.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let cookie: string;
let tournament: Tournament;
let url: string;
beforeEach(async () => {
  t = await makeApp();
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Torneo Oct', slug: 'torneo-oct' });
  t.repo.setActiveTournament(tournament.id);
  url = `/admin/t/${tournament.id}/config`;
});
afterEach(() => t.db.close());

const dayForm = (rows: { phase: string; date: string; times: string; minutes?: string }[]) => ({
  day_phase: rows.map((r) => r.phase),
  day_date: rows.map((r) => r.date),
  day_times: rows.map((r) => r.times),
  day_minutes: rows.map((r) => r.minutes ?? '60'),
});

const base = { action: 'save', name: 'Torneo Oct', slug: 'torneo-oct', game: 'Dota 2' };

describe('config screen', () => {
  it('renders general data and calendar in Spanish', async () => {
    t.repo.replaceScheduleDays(tournament.id, [
      { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00'], slotMinutes: 60 },
    ]);
    const html = await (await t.get(url, cookie)).text();
    expect(html).toContain('Configuración');
    expect(html).toContain('value="Torneo Oct"');
    expect(html).toContain('value="torneo-oct"');
    expect(html).toContain('value="Dota 2"');
    expect(html).toContain('value="2026-10-03"');
    expect(html).toContain('value="14:00, 15:00"');
    expect(html).toContain('Agregar día');
    // The calendar table carries the class the stylesheet sizes its columns with.
    expect(html).toContain('<table class="cal cards">');
    expect(html).not.toMatch(/name="day_minutes"[^>]*style=/);
    // The calendar card sits on its own full-width row instead of sharing the two-column grid.
    expect(html).toContain('class="card stack cal-card"');
    expect(html).not.toMatch(/class="grid2">\s*<div class="card stack"[^>]*>\s*<h2>General/);
    // Each cell carries its column name so phones can stack a day as a small card.
    for (const label of ['Fase', 'Fecha', 'Horarios', 'Min. c/u']) expect(html).toContain(`data-label="${label}"`);
  });

  it('ships the calendar and mobile-nav rules in the admin stylesheet', async () => {
    const css = await (await t.get('/assets/admin.css')).text();
    expect(css).toMatch(/table\.cal\s*\{[^}]*table-layout:fixed/);
    expect(css).not.toMatch(/table\.cal\s*\{[^}]*min-width:680px/);
    expect(css).toContain('attr(data-label)');
    expect(css).toMatch(/nav\.side::-webkit-scrollbar\s*\{display:none\}/);
    expect(css).toMatch(/nav\.side\s*\{[^}]*scrollbar-width:none/);
  });

  it('links the public page at / for the active tournament and /t/<slug> otherwise', async () => {
    const other = t.repo.createTournament({ name: 'Beta Cup', slug: 'beta' });
    const active = await (await t.get(url, cookie)).text();
    expect(active).toContain('href="/"');
    expect(active).toContain('Ver página pública');
    const html = await (await t.get(`/admin/t/${other.id}/config`, cookie)).text();
    expect(html).toContain('href="/t/beta"');
  });

  it('answers 404 for an unknown tournament', async () => {
    expect((await t.get('/admin/t/999/config', cookie)).status).toBe(404);
  });

  it('saves general data and the calendar', async () => {
    const res = await t.post(
      url,
      {
        ...base,
        name: 'Torneo Renombrado',
        slug: 'renombrado',
        game: 'Dota 2 CM',
        ...dayForm([
          { phase: 'group', date: '2026-10-03', times: '14:00, 15:00,16:00', minutes: '45' },
          { phase: 'semifinal', date: '2026-10-11', times: '14:00' },
          { phase: 'final', date: '2026-10-17', times: '14:00' },
        ]),
      },
      cookie,
    );
    expect(res.status).toBe(303);
    const saved = t.repo.getTournamentById(tournament.id)!;
    expect(saved).toMatchObject({ name: 'Torneo Renombrado', slug: 'renombrado', game: 'Dota 2 CM' });
    expect(t.repo.listScheduleDays(tournament.id)).toEqual([
      { date: '2026-10-03', phase: 'group', startTimes: ['14:00', '15:00', '16:00'], slotMinutes: 45 },
      { date: '2026-10-11', phase: 'semifinal', startTimes: ['14:00'], slotMinutes: 60 },
      { date: '2026-10-17', phase: 'final', startTimes: ['14:00'], slotMinutes: 60 },
    ]);
  });

  it('emits a change event on save', async () => {
    let fired = 0;
    t.events.onTournamentChanged(tournament.id, () => fired++);
    await t.post(url, base, cookie);
    expect(fired).toBe(1);
  });

  it('skips fully blank calendar rows', async () => {
    await t.post(url, { ...base, ...dayForm([{ phase: 'group', date: '', times: '' }]) }, cookie);
    expect(t.repo.listScheduleDays(tournament.id)).toEqual([]);
  });

  it('rejects invalid input with Spanish messages and saves nothing', async () => {
    t.repo.createTournament({ name: 'Otro', slug: 'otro' });
    const okDay = { phase: 'group', date: '2026-10-03', times: '14:00' };
    const cases: [Record<string, string | string[]>, string][] = [
      [{ ...base, name: '' }, 'nombre'],
      [{ ...base, slug: 'Mal Slug' }, 'URL pública'],
      [{ ...base, slug: 'otro' }, 'Ya existe'],
      [{ ...base, game: '' }, 'juego'],
      [{ ...base, ...dayForm([{ ...okDay, date: '2026-13-40' }]) }, 'fecha'],
      [{ ...base, ...dayForm([{ ...okDay, times: '25:00' }]) }, 'horario'],
      [{ ...base, ...dayForm([{ ...okDay, times: '14:00, 14:00' }]) }, 'repetido'],
      [{ ...base, ...dayForm([{ ...okDay, times: '' }]) }, 'horario'],
      [{ ...base, ...dayForm([{ ...okDay, phase: 'bogus' }]) }, 'fase'],
      [{ ...base, ...dayForm([{ ...okDay, minutes: '0' }]) }, 'minutos'],
      [{ ...base, ...dayForm([{ ...okDay, minutes: 'abc' }]) }, 'minutos'],
    ];
    for (const [form, message] of cases) {
      const res = await t.post(url, form, cookie);
      expect(res.status).toBe(303);
      expect(await flashText(t, res, cookie)).toContain(message);
    }
    expect(t.repo.getTournamentById(tournament.id)).toMatchObject({ name: 'Torneo Oct', slug: 'torneo-oct' });
    expect(t.repo.listScheduleDays(tournament.id)).toEqual([]);
  });

  it('adds and removes calendar days', async () => {
    const rows = dayForm([
      { phase: 'group', date: '2026-10-03', times: '14:00' },
      { phase: 'final', date: '2026-10-17', times: '14:00' },
    ]);
    await t.post(url, { ...base, ...rows, action: 'add' }, cookie);
    expect(t.repo.listScheduleDays(tournament.id)).toHaveLength(3);
    await t.post(url, { ...base, ...rows, action: 'remove:0' }, cookie);
    expect(t.repo.listScheduleDays(tournament.id).map((d) => d.phase)).toEqual(['final']);
  });

  it('offers a time zone select with America/Lima selected by default', async () => {
    const html = await (await t.get(url, cookie)).text();
    expect(html).toContain('name="timezone"');
    expect(html).toMatch(/<option value="America\/Lima" selected(="")?>/);
    expect(html).toContain('value="Europe/Madrid"');
    expect(html).toContain('Zona horaria');
  });

  it('saves a valid zone and keeps existing matches at the same instant', async () => {
    const match = t.repo.createMatch({ tournamentId: tournament.id, phase: 'group', round: 1, matchNumber: 1, scheduledDate: '2026-10-03', startTime: '14:00', endTime: '15:00' });
    const res = await t.post(url, { ...base, timezone: 'Europe/Madrid' }, cookie);
    expect(await flashText(t, res, cookie)).toContain('Configuración guardada');
    expect(t.repo.getTournamentById(tournament.id)!.timezone).toBe('Europe/Madrid');
    expect(t.repo.getMatch(match.id)).toMatchObject({ startsAt: '2026-10-03T19:00:00Z', startTime: '21:00' });
  });

  it('rejects an unknown zone in Spanish', async () => {
    const res = await t.post(url, { ...base, timezone: 'Mars/Olympus' }, cookie);
    expect(await flashText(t, res, cookie)).toContain('zona horaria');
    expect(t.repo.getTournamentById(tournament.id)!.timezone).toBe('America/Lima');
  });

  it('generates matches from calendar days read in the tournament zone', async () => {
    t.repo.updateTournament(tournament.id, { timezone: 'Europe/Madrid' });
    t.repo.createTeam(tournament.id, { code: 'A', name: 'A' });
    t.repo.createTeam(tournament.id, { code: 'B', name: 'B' });
    t.repo.replaceScheduleDays(tournament.id, [{ date: '2026-10-03', phase: 'group', startTimes: ['14:00'], slotMinutes: 60 }]);
    const { regenerateFixture } = await import('../src/services/fixture.js');
    regenerateFixture(t.repo, t.repo.getTournamentById(tournament.id)!);
    expect(t.repo.listMatches(tournament.id, 'group')[0]).toMatchObject({ startsAt: '2026-10-03T12:00:00Z', endsAt: '2026-10-03T13:00:00Z' });
  });
});
