import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app.js';

const css = readFileSync(new URL('../public/site.css', import.meta.url), 'utf8');

let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
  const cup = t.repo.createTournament({ name: 'Copa Secuencial', slug: 'seq' });
  t.repo.setActiveTournament(cup.id);
  const teams = ['A', 'B', 'C', 'D', 'E'].map((code) => t.repo.createTeam(cup.id, { code, name: `Equipo ${code}` }));
  // Sequential slots: every round is a single match, except round 4 which has three.
  const at = (n: number, h: number) => ({ scheduledDate: '2026-10-03', startTime: `${h}:00`, endTime: `${h + 1}:00`, round: n, matchNumber: n });
  t.repo.createMatch({ tournamentId: cup.id, phase: 'group', team1Id: teams[0]!.id, team2Id: teams[1]!.id, ...at(1, 14) });
  t.repo.createMatch({ tournamentId: cup.id, phase: 'group', team1Id: teams[2]!.id, team2Id: teams[3]!.id, ...at(2, 15) });
  t.repo.createMatch({ tournamentId: cup.id, phase: 'group', team1Id: teams[0]!.id, team2Id: teams[2]!.id, ...at(3, 16) });
  for (const [i, [a, b]] of [[0, 3], [1, 4], [2, 4]].entries()) {
    t.repo.createMatch({ tournamentId: cup.id, phase: 'group', team1Id: teams[a!]!.id, team2Id: teams[b!]!.id, ...at(4, 17), matchNumber: 4 + i });
  }
});
afterEach(() => t.db.close());

const rounds = (html: string) => [...html.matchAll(/<div class="round"([^>]*)>/g)].map((m) => m[1]!);

describe('rounds as grid cells', () => {
  it('marks every round with how many matches it holds', async () => {
    const html = await (await t.get('/')).text();
    const counts = rounds(html).map((attrs) => /data-matches="(\d+)"/.exec(attrs)?.[1]);
    expect(counts).toEqual(['1', '1', '1', '3']);
    expect(html.match(/<article class="match/g)).toHaveLength(6);
  });

  it('keeps each round header and its cards together in one block', async () => {
    const html = await (await t.get('/')).text();
    const blocks = html.split('<div class="round"').slice(1);
    expect(blocks).toHaveLength(4);
    expect(blocks[3]!.match(/<article class="match/g)).toHaveLength(3);
    expect(blocks[0]!.match(/<article class="match/g)).toHaveLength(1);
    expect(blocks[0]).toContain('Ronda 1');
  });

  it('lays days out as a responsive grid: one cell per single-match round, full rows for the rest', () => {
    expect(css).toMatch(/\.days \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(auto-fill, minmax\(340px, 1fr\)\)/);
    expect(css).toMatch(/\.day-head[^{]*\{[^}]*grid-column: 1 \/ -1/);
    expect(css).toMatch(/\.round:not\(\[data-matches="1"\]\) \{[^}]*grid-column: 1 \/ -1/);
    // A round with several matches keeps its inner grid of cards.
    expect(css).toMatch(/\.matches \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(320px, 1fr\)\)/);
  });

  it('gives the matches tab room for 3 columns at 1280 px and 4 at 1920 px, other tabs stay narrower', () => {
    expect(css).toMatch(/main\.wrap \{[^}]*width: min\(1440px, 100%\)/);
    expect(css).toMatch(/\.panel:not\(\[data-panel="partidos"\]\) \{[^}]*width: min\(1080px, 100%\)/);
  });

  it('gives every round header the height of one with a tag, so cards in a row line up', () => {
    // .tag is 11px text + 2x4px padding + 2x1px border = 21px; the header never gets shorter than that.
    expect(css).toMatch(/\.round-head \{[^}]*min-height: 21px/);
    expect(css).toMatch(/\.round-head \{[^}]*align-items: center/);
  });

  it('lets the header of a narrow cell wrap, with "Descansa" on its own line under the title', () => {
    expect(css).toMatch(/\.round\[data-matches="1"\] \.rest \{[^}]*flex-basis: 100%/);
    expect(css).toMatch(/\.round-head \{[^}]*flex-wrap: wrap/);
  });

  it('is still one flat list under .days, which the browser regroups by local day', () => {
    const js = readFileSync(new URL('../public/site.js', import.meta.url), 'utf8');
    expect(js).toContain("'.days > .round'");
  });
});
