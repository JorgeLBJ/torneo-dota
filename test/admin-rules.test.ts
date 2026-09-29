import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tournament } from '../src/db/repository.js';
import { renderRulebook } from '../src/markdown.js';
import { flashText, makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let cookie: string;
let tournament: Tournament;
let url: string;
beforeEach(async () => {
  t = await makeApp();
  cookie = await t.login();
  tournament = t.repo.createTournament({ name: 'Torneo Oct', slug: 'torneo-oct' });
  url = `/admin/t/${tournament.id}/reglas`;
});
afterEach(() => t.db.close());

const base = {
  action: 'save',
  points_win: '1',
  points_loss: '0',
  group_legs: '1',
  tiebreakers: 'kd,kills',
  rules_text: '',
};

describe('rules screen', () => {
  it('renders scoring, tiebreakers, format and rulebook', async () => {
    const html = await (await t.get(url, cookie)).text();
    expect(html).toContain('Reglas');
    expect(html).toContain('Puntuación');
    expect(html).toContain('Diferencia K − D');
    expect(html).toContain('Más kills');
    expect(html).toContain('Todos contra todos · una vuelta');
    expect(html).toContain('Todos contra todos · ida y vuelta');
    expect(html).toContain('Reglamento');
    expect(html).toContain('4 (semis 1v4');
  });

  it('saves points, legs and rulebook', async () => {
    const res = await t.post(
      url,
      { ...base, points_win: '3', points_loss: '1', group_legs: '2', rules_text: '## Generales\n- Uno' },
      cookie,
    );
    expect(res.status).toBe(303);
    expect(t.repo.getTournamentById(tournament.id)).toMatchObject({
      pointsWin: 3,
      pointsLoss: 1,
      groupLegs: 2,
      rulesText: '## Generales\n- Uno',
    });
  });

  it('reorders tiebreakers with up/down buttons', async () => {
    await t.post(url, { ...base, action: 'up:kills' }, cookie);
    expect(t.repo.getTournamentById(tournament.id)!.tiebreakers).toEqual(['kills', 'kd']);
    await t.post(url, { ...base, tiebreakers: 'kills,kd', action: 'down:kills' }, cookie);
    expect(t.repo.getTournamentById(tournament.id)!.tiebreakers).toEqual(['kd', 'kills']);
    // Moving the first item up (or the last down) is a no-op.
    await t.post(url, { ...base, action: 'up:kd' }, cookie);
    expect(t.repo.getTournamentById(tournament.id)!.tiebreakers).toEqual(['kd', 'kills']);
  });

  it('ignores unknown or duplicated tiebreaker keys', async () => {
    const res = await t.post(url, { ...base, tiebreakers: 'kd,kd,evil' }, cookie);
    expect(await flashText(t, res, cookie)).toContain('desempate');
    expect(t.repo.getTournamentById(tournament.id)!.tiebreakers).toEqual(['kd', 'kills']);
  });

  it('validates input with Spanish messages and saves nothing', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ ...base, points_win: 'x' }, 'puntos'],
      [{ ...base, points_win: '-1' }, 'puntos'],
      [{ ...base, points_win: '0', points_loss: '2' }, 'mayores'],
      [{ ...base, group_legs: '3' }, 'formato'],
      [{ ...base, rules_text: 'x'.repeat(20001) }, 'reglamento'],
    ];
    for (const [form, message] of cases) {
      const res = await t.post(url, form, cookie);
      expect(await flashText(t, res, cookie)).toContain(message);
    }
    expect(t.repo.getTournamentById(tournament.id)).toMatchObject({ pointsWin: 1, groupLegs: 1, rulesText: '' });
  });

  it('warns to regenerate the fixture when the format changes and a fixture exists', async () => {
    const a = t.repo.createTeam(tournament.id, { code: 'A', name: 'Alpha' });
    const b = t.repo.createTeam(tournament.id, { code: 'B', name: 'Bravo' });
    t.repo.insertMatches([{ tournamentId: tournament.id, phase: 'group', round: 1, matchNumber: 1, team1Id: a.id, team2Id: b.id }]);
    const res = await t.post(url, { ...base, group_legs: '2' }, cookie);
    expect(await flashText(t, res, cookie)).toContain('Regenera el fixture');
  });

  it('emits a change event on save', async () => {
    let fired = 0;
    t.events.onTournamentChanged(tournament.id, () => fired++);
    await t.post(url, base, cookie);
    expect(fired).toBe(1);
  });
});

describe('rulebook renderer', () => {
  it('turns ## headings and - lists into blocks and paragraphs', () => {
    const blocks = renderRulebook('## Generales\n- Uno\n- Dos\n\nTexto libre\n\n## Otra\n- Tres');
    expect(blocks).toEqual([
      { type: 'heading', text: 'Generales' },
      { type: 'list', items: ['Uno', 'Dos'] },
      { type: 'paragraph', text: 'Texto libre' },
      { type: 'heading', text: 'Otra' },
      { type: 'list', items: ['Tres'] },
    ]);
  });

  it('keeps markup as plain text (escaping happens at render time)', () => {
    expect(renderRulebook('## <script>alert(1)</script>\n- <b>x</b>')).toEqual([
      { type: 'heading', text: '<script>alert(1)</script>' },
      { type: 'list', items: ['<b>x</b>'] },
    ]);
  });

  it('ignores unsupported syntax such as ### and blank input', () => {
    expect(renderRulebook('')).toEqual([]);
    expect(renderRulebook('### Not a heading')).toEqual([{ type: 'paragraph', text: '### Not a heading' }]);
  });

  it('is escaped when rendered in the admin preview', async () => {
    await t.post(url, { ...base, rules_text: '## <script>alert(1)</script>\n- <img src=x onerror=1>' }, cookie);
    const html = await (await t.get(url, cookie)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
  });
});
