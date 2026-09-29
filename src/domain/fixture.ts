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
}

export interface RoundSlot {
  round: number;
  date: string;
  startTime: string;
  endTime: string;
}

/** Single round-robin using the circle method. Odd counts get a bye per round. */
export function generateRoundRobin(teamIds: number[]): Round[] {
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
  return rounds;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const total = h * 60 + m + minutes;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Assigns each round (all its matches at once) to the next free date/time slot. */
export function assignSchedule(rounds: Round[], days: DaySlots[], slotMinutes: number): RoundSlot[] {
  const free = days.flatMap((d) => d.startTimes.map((startTime) => ({ date: d.date, startTime })));
  if (free.length < rounds.length) {
    throw new Error(`Insufficient time slots: ${rounds.length} rounds need slots but only ${free.length} available`);
  }
  return rounds.map((r, i) => {
    const slot = free[i]!;
    return {
      round: r.round,
      date: slot.date,
      startTime: slot.startTime,
      endTime: addMinutes(slot.startTime, slotMinutes),
    };
  });
}
