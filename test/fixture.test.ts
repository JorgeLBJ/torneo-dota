import { describe, expect, it } from 'vitest';
import { assignSchedule, generateRoundRobin } from '../src/domain/fixture.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

describe.each([2, 3, 4, 5, 6, 7, 8])('generateRoundRobin with %i teams', (n) => {
  const rounds = generateRoundRobin(ids(n));

  it('plays every pair exactly once', () => {
    const pairs = rounds.flatMap((r) => r.matches.map(([a, b]) => key(a, b)));
    expect(pairs).toHaveLength((n * (n - 1)) / 2);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('never repeats a team within a round', () => {
    for (const r of rounds) {
      const seen = r.matches.flat();
      if (r.bye !== null) seen.push(r.bye);
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  it('has n-1 rounds when even and n rounds when odd', () => {
    expect(rounds).toHaveLength(n % 2 === 0 ? n - 1 : n);
    expect(rounds.map((r) => r.round)).toEqual(rounds.map((_, i) => i + 1));
  });

  it('gives each team exactly one bye when odd and none when even', () => {
    const byes = rounds.map((r) => r.bye).filter((b) => b !== null);
    if (n % 2 === 0) {
      expect(byes).toHaveLength(0);
    } else {
      expect([...byes].sort((a, b) => a - b)).toEqual(ids(n));
    }
  });

  it('is deterministic', () => {
    expect(generateRoundRobin(ids(n))).toEqual(rounds);
  });
});

describe('generateRoundRobin errors', () => {
  it('rejects fewer than 2 teams', () => {
    expect(() => generateRoundRobin([])).toThrow();
    expect(() => generateRoundRobin([1])).toThrow();
  });

  it('rejects duplicate team ids', () => {
    expect(() => generateRoundRobin([1, 2, 2, 3])).toThrow(/duplicate/i);
  });
});

describe('assignSchedule', () => {
  const hours = ['14:00', '15:00', '16:00', '17:00'];
  const days = [
    { date: '2026-10-03', startTimes: hours },
    { date: '2026-10-10', startTimes: hours },
  ];

  it('places 7 rounds as 4 on day 1 and 3 on day 2', () => {
    const rounds = generateRoundRobin(ids(7));
    const slots = assignSchedule(rounds, days, 45);
    expect(slots).toHaveLength(7);
    expect(slots.filter((s) => s.date === '2026-10-03')).toHaveLength(4);
    expect(slots.filter((s) => s.date === '2026-10-10')).toHaveLength(3);
    expect(slots[0]).toEqual({ round: 1, date: '2026-10-03', startTime: '14:00', endTime: '14:45' });
    expect(slots[3]).toEqual({ round: 4, date: '2026-10-03', startTime: '17:00', endTime: '17:45' });
    expect(slots[4]).toEqual({ round: 5, date: '2026-10-10', startTime: '14:00', endTime: '14:45' });
  });

  it('rolls end time over the hour', () => {
    const slots = assignSchedule(generateRoundRobin(ids(2)), [{ date: '2026-10-03', startTimes: ['09:30'] }], 60);
    expect(slots[0]?.endTime).toBe('10:30');
  });

  it('throws when slots are insufficient', () => {
    expect(() => assignSchedule(generateRoundRobin(ids(7)), [days[0]!], 45)).toThrow(/insufficient/i);
  });
});

describe('generateRoundRobin double round-robin', () => {
  it('doubles the rounds and mirrors the first leg with home/away swapped', () => {
    const single = generateRoundRobin(ids(4), 1);
    const double = generateRoundRobin(ids(4), 2);
    expect(double).toHaveLength(single.length * 2);
    single.forEach((round, i) => {
      const mirror = double[single.length + i]!;
      expect(mirror.round).toBe(single.length + i + 1);
      expect(mirror.matches).toEqual(round.matches.map(([a, b]) => [b, a]));
      expect(mirror.bye).toBe(round.bye);
    });
  });

  it('plays every ordered pair exactly once with 5 teams', () => {
    const seen = new Set<string>();
    for (const r of generateRoundRobin(ids(5), 2)) for (const [a, b] of r.matches) seen.add(`${a}>${b}`);
    expect(seen.size).toBe(20);
  });

  it('defaults to a single leg', () => {
    expect(generateRoundRobin(ids(4))).toEqual(generateRoundRobin(ids(4), 1));
  });
});

describe('assignSchedule slot minutes per day', () => {
  it('lets a day override the default slot length', () => {
    const slots = assignSchedule(
      generateRoundRobin(ids(4)),
      [
        { date: '2026-10-03', startTimes: ['14:00', '15:00'], slotMinutes: 30 },
        { date: '2026-10-04', startTimes: ['14:00'] },
      ],
      60,
    );
    expect(slots.map((s) => s.endTime)).toEqual(['14:30', '15:30', '15:00']);
  });
});

describe('time validation', () => {
  const day = (t: string) => [{ date: '2026-10-03', startTimes: [t] }];
  it('rejects malformed start times', () => {
    for (const bad of ['9:00', '25:00', '14:60', 'abc', '']) {
      expect(() => assignSchedule(generateRoundRobin(ids(2)), day(bad), 60)).toThrow(/time/i);
    }
  });
  it('rejects non-positive or fractional slot minutes', () => {
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      expect(() => assignSchedule(generateRoundRobin(ids(2)), day('14:00'), bad)).toThrow(/minutes/i);
    }
  });
});
