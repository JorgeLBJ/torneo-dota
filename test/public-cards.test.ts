import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { regenerateFixture } from '../src/services/fixture.js';
import { makeApp, type TestApp } from './helpers/app.js';

const css = readFileSync(new URL('../public/site.css', import.meta.url), 'utf8');
const rule = (selector: string) => {
  const i = css.indexOf(`${selector} {`);
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
};

let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
  const tour = t.repo.createTournament({ name: 'Copa', slug: 'copa' });
  t.repo.setActiveTournament(tour.id);
  t.repo.createTeam(tour.id, { code: 'A', name: 'BKB? PARA TORNEOS CON UN NOMBRE LARGUISIMO', hero: 'axe' });
  t.repo.createTeam(tour.id, { code: 'B', name: 'Bravo', hero: 'lina' });
  t.repo.replaceScheduleDays(tour.id, [{ date: '2026-10-03', phase: 'group', startTimes: ['14:00'], slotMinutes: 60 }]);
  regenerateFixture(t.repo, tour);
});
afterEach(() => t.db.close());

describe('public match cards', () => {
  it('the full team name is in a title, because the visible name is clamped to two lines', async () => {
    const html = await (await t.get('/')).text();
    expect(html).toContain('<strong title="BKB? PARA TORNEOS CON UN NOMBRE LARGUISIMO">');
    expect(html).toContain('<strong title="Bravo">');
  });

  it('portraits of both sides share one grid row; names are in the row below', () => {
    expect(rule('.match')).toContain('grid-template-rows: auto 1fr');
    expect(rule('.match')).toContain('align-items: start');
    expect(rule('.side')).toContain('display: contents');
    expect(rule('.side .portrait')).toContain('grid-row: 1');
    expect(rule('.side .who')).toContain('grid-row: 2');
    // the score column sits in the portraits' row, centred against it
    expect(rule('.mid')).toContain('grid-row: 1');
    expect(rule('.mid')).toContain('align-self: center');
  });

  it('names are clamped to two lines everywhere they appear', () => {
    for (const selector of ['.who strong', '.team strong', '.slot strong']) {
      expect(rule(selector)).toContain('-webkit-line-clamp: 2');
      expect(rule(selector)).toContain('overflow: hidden');
    }
  });
});
