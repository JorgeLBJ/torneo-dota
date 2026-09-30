export interface StandingTeam {
  id: number;
  code: string;
  name: string;
}

export interface GroupMatch {
  matchNumber: number;
  team1Id: number | null;
  team2Id: number | null;
  winnerId: number | null;
  team1Kills: number | null;
  team1Deaths: number | null;
  team2Kills: number | null;
  team2Deaths: number | null;
}

export type QualificationStatus = 'pending' | 'qualified' | 'eliminated' | 'tiebreak';

export interface StandingRow {
  teamId: number;
  code: string;
  name: string;
  /** 1-based competition rank; teams tied on every criterion share it. */
  rank: number;
  played: number;
  wins: number;
  losses: number;
  points: number;
  kills: number;
  deaths: number;
  diff: number;
  /** Up to the last 5 results, oldest first (chronological by match number). */
  last5: ('W' | 'L')[];
  /** Other team ids tied on points, diff and kills (only among teams that have played). */
  tiedWith: number[];
  unresolvedTie: boolean;
  status: QualificationStatus;
}

export type TiebreakCriterion = 'kd' | 'kills' | 'h2h';

export interface StandingsRules {
  pointsWin?: number;
  pointsLoss?: number;
  /** Ordered criteria applied after points. */
  tiebreakers?: TiebreakCriterion[];
}

/** Criteria that give each team a number (higher is better). Head-to-head is handled apart: it looks at matches. */
const CRITERION_VALUE: Record<'kd' | 'kills', (row: StandingRow) => number> = {
  kd: (row) => row.diff,
  kills: (row) => row.kills,
};

const KNOWN_CRITERIA = new Set<string>(['kd', 'kills', 'h2h']);

interface Acc extends StandingRow {
  results: { matchNumber: number; result: 'W' | 'L' }[];
}

/**
 * Standings derived purely from played group matches (winner set).
 * Order: points desc, then the configured tiebreakers in order (default kill diff desc, kills desc;
 * `h2h` is the result between the tied teams), then team code for a stable display only.
 * Each criterion is applied only to the teams still level after the previous ones. Ties that survive every
 * criterion are flagged, never broken by name.
 */
export function computeStandings(
  teams: StandingTeam[],
  groupMatches: GroupMatch[],
  qualifiers: number,
  rules: StandingsRules = {},
): StandingRow[] {
  const { pointsWin = 1, pointsLoss = 0, tiebreakers = ['kd', 'kills'] } = rules;
  // Stored values are not trusted: unknown or repeated criteria are skipped.
  const criteria = [...new Set(tiebreakers)].filter((name) => KNOWN_CRITERIA.has(name));
  const acc = new Map<number, Acc>();
  for (const t of teams) {
    acc.set(t.id, {
      teamId: t.id,
      code: t.code,
      name: t.name,
      rank: 0,
      played: 0,
      wins: 0,
      losses: 0,
      points: 0,
      kills: 0,
      deaths: 0,
      diff: 0,
      last5: [],
      tiedWith: [],
      unresolvedTie: false,
      status: 'pending',
      results: [],
    });
  }

  for (const match of groupMatches) {
    if (match.winnerId === null || match.team1Id === null || match.team2Id === null) continue;
    const sides = [
      { id: match.team1Id, kills: match.team1Kills, deaths: match.team1Deaths },
      { id: match.team2Id, kills: match.team2Kills, deaths: match.team2Deaths },
    ];
    for (const side of sides) {
      const row = acc.get(side.id);
      if (!row) continue;
      const won = side.id === match.winnerId;
      row.played += 1;
      row.wins += won ? 1 : 0;
      row.losses += won ? 0 : 1;
      row.points += won ? pointsWin : pointsLoss;
      row.kills += side.kills ?? 0;
      row.deaths += side.deaths ?? 0;
      row.results.push({ matchNumber: match.matchNumber, result: won ? 'W' : 'L' });
    }
  }

  const rows = [...acc.values()];
  for (const row of rows) {
    row.diff = row.kills - row.deaths;
    row.results.sort((a, b) => a.matchNumber - b.matchNumber);
    row.last5 = row.results.slice(-5).map((r) => r.result);
  }

  // Wins of each team in the mini-league formed by `group` alone: only played matches between two members count.
  const headToHeadWins = (group: Acc[]): Map<number, number> => {
    const members = new Set(group.map((row) => row.teamId));
    const wins = new Map(group.map((row) => [row.teamId, 0]));
    for (const match of groupMatches) {
      if (match.winnerId === null || match.team1Id === null || match.team2Id === null) continue;
      if (!members.has(match.team1Id) || !members.has(match.team2Id)) continue;
      wins.set(match.winnerId, (wins.get(match.winnerId) ?? 0) + 1);
    }
    return wins;
  };

  // Splits a set of tied teams into ordered blocks of teams that are still level, applying the criteria in order.
  const split = (group: Acc[], from: number): Acc[][] => {
    const name = criteria[from];
    if (group.length < 2 || name === undefined) return [group];
    const scoreOf: (row: Acc) => number =
      name === 'h2h'
        ? ((wins) => (row: Acc) => wins.get(row.teamId) ?? 0)(headToHeadWins(group))
        : CRITERION_VALUE[name as 'kd' | 'kills'];
    const levels = new Map<number, Acc[]>();
    for (const row of group) levels.set(scoreOf(row), [...(levels.get(scoreOf(row)) ?? []), row]);
    return [...levels.keys()]
      .sort((x, y) => y - x)
      .flatMap((score) => split(levels.get(score)!, from + 1));
  };

  const byPoints = new Map<number, Acc[]>();
  for (const row of rows) byPoints.set(row.points, [...(byPoints.get(row.points) ?? []), row]);
  const blocks = [...byPoints.keys()]
    .sort((x, y) => y - x)
    .flatMap((points) => split(byPoints.get(points)!, 0))
    .map((block) => [...block].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)));

  const ordered = blocks.flat();
  // Group consecutive rows that are level on every criterion.
  const groups: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const block of blocks) {
    groups.push({ start: cursor, end: cursor + block.length - 1 });
    cursor += block.length;
  }
  rows.splice(0, rows.length, ...ordered);

  const complete = groupMatches.length > 0 && groupMatches.every((mt) => mt.winnerId !== null);

  for (const { start, end } of groups) {
    const members = rows.slice(start, end + 1);
    for (const row of members) {
      row.rank = start + 1;
      const tied = members.filter((o) => o !== row && o.played > 0 && row.played > 0);
      row.tiedWith = tied.map((o) => o.teamId).sort((a, b) => a - b);
      row.unresolvedTie = row.tiedWith.length > 0;
      if (!complete) row.status = 'pending';
      else if (start < qualifiers && end >= qualifiers) row.status = 'tiebreak';
      else row.status = start < qualifiers ? 'qualified' : 'eliminated';
    }
  }

  return rows.map(({ results: _results, ...row }) => row);
}
