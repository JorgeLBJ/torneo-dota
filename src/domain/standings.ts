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

export type TiebreakCriterion = 'kd' | 'kills';

export interface StandingsRules {
  pointsWin?: number;
  pointsLoss?: number;
  /** Ordered criteria applied after points. */
  tiebreakers?: TiebreakCriterion[];
}

const CRITERION_VALUE: Record<TiebreakCriterion, (row: StandingRow) => number> = {
  kd: (row) => row.diff,
  kills: (row) => row.kills,
};

interface Acc extends StandingRow {
  results: { matchNumber: number; result: 'W' | 'L' }[];
}

/**
 * Standings derived purely from played group matches (winner set).
 * Order: points desc, then the configured tiebreakers (default kill diff desc,
 * kills desc), then team code for a stable display only. Ties on every
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
  const criteria = [...new Set(tiebreakers)].flatMap((name) => (name in CRITERION_VALUE ? [CRITERION_VALUE[name]] : []));
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

  const compare = (a: Acc, b: Acc): number => {
    if (a.points !== b.points) return b.points - a.points;
    for (const value of criteria) {
      const delta = value(b) - value(a);
      if (delta !== 0) return delta;
    }
    return 0;
  };

  rows.sort((a, b) => compare(a, b) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const sameKey = (a: Acc, b: Acc) => compare(a, b) === 0;

  // Group consecutive rows that tie on every criterion.
  const groups: { start: number; end: number }[] = [];
  for (let i = 0; i < rows.length; ) {
    let j = i;
    while (j + 1 < rows.length && sameKey(rows[i]!, rows[j + 1]!)) j++;
    groups.push({ start: i, end: j });
    i = j + 1;
  }

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
