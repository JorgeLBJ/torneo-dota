export interface Round {
  /** 1-based round number. */
  round: number;
  matches: [number, number][];
  /** Team resting this round (odd team counts only), otherwise null. */
  bye: number | null;
}

export interface DaySlots {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM start times, in play order. */
  startTimes: string[];
  /** Optional slot length for this day; falls back to the schedule default. */
  slotMinutes?: number;
}

export interface RoundSlot {
  round: number;
  date: string;
  startTime: string;
  endTime: string;
}

/**
 * Round-robin using the circle method. Odd counts get a bye per round.
 * With `legs = 2` the second leg repeats the first with home/away swapped.
 */
export function generateRoundRobin(teamIds: number[], legs: 1 | 2 = 1): Round[] {
  if (teamIds.length < 2) throw new Error('At least 2 teams are required');
  if (new Set(teamIds).size !== teamIds.length) throw new Error('Duplicate team ids');

  const circle: (number | null)[] = [...teamIds];
  if (circle.length % 2 === 1) circle.push(null);
  const size = circle.length;

  const rounds: Round[] = [];
  for (let r = 0; r < size - 1; r++) {
    const matches: [number, number][] = [];
    let bye: number | null = null;
    for (let i = 0; i < size / 2; i++) {
      const a = circle[i] ?? null;
      const b = circle[size - 1 - i] ?? null;
      if (a === null) bye = b;
      else if (b === null) bye = a;
      else matches.push([a, b]);
    }
    rounds.push({ round: r + 1, matches, bye });
    // Keep the first position fixed and rotate the rest clockwise.
    circle.splice(1, 0, circle.pop() ?? null);
  }
  if (legs === 1) return rounds;
  const firstLeg = rounds.length;
  const secondLeg = rounds.map((r, i) => ({
    round: firstLeg + i + 1,
    matches: r.matches.map(([a, b]): [number, number] => [b, a]),
    bye: r.bye,
  }));
  return [...rounds, ...secondLeg];
}

const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function isValidTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/**
 * Whether an end time is a believable end for a start time on the same slot: later the same day, or
 * (for a slot running past midnight) earlier on the clock but at most 12 hours after the start.
 */
export function isPlausibleSlot(start: string, end: string): boolean {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const span = (minutes(end) - minutes(start) + 1440) % 1440;
  return span > 0 && (minutes(end) > minutes(start) || span <= 12 * 60);
}

export function addMinutes(time: string, minutes: number): string {
  if (!isValidTime(time)) throw new Error(`Invalid time "${time}": expected HH:MM`);
  if (!Number.isInteger(minutes) || minutes <= 0) throw new Error(`Invalid slot minutes: ${minutes}`);
  const [h, m] = time.split(':').map(Number) as [number, number];
  const total = h * 60 + m + minutes;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Assigns each round (all its matches at once) to the next free date/time slot. */
export function assignSchedule(rounds: Round[], days: DaySlots[], slotMinutes: number): RoundSlot[] {
  const free = days.flatMap((d) =>
    d.startTimes.map((startTime) => ({ date: d.date, startTime, minutes: d.slotMinutes ?? slotMinutes })),
  );
  if (free.length < rounds.length) {
    throw new Error(`Insufficient time slots: ${rounds.length} rounds need slots but only ${free.length} available`);
  }
  return rounds.map((r, i) => {
    const slot = free[i]!;
    return {
      round: r.round,
      date: slot.date,
      startTime: slot.startTime,
      endTime: addMinutes(slot.startTime, slot.minutes),
    };
  });
}

export interface RoundRobinSummary {
  rounds: number;
  matches: number;
  /** Teams resting in every round (1 for odd team counts). */
  byesPerRound: number;
}

/** Size of a round-robin for a team count: rounds, matches and byes per round. */
export function describeRoundRobin(teams: number, legs: 1 | 2 = 1): RoundRobinSummary {
  if (teams < 2) return { rounds: 0, matches: 0, byesPerRound: 0 };
  const odd = teams % 2 === 1;
  return {
    rounds: (odd ? teams : teams - 1) * legs,
    matches: ((teams * (teams - 1)) / 2) * legs,
    byesPerRound: odd ? 1 : 0,
  };
}
