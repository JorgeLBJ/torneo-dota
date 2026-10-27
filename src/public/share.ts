import type { Team } from '../db/repository.js';
import { DE_SLOTS, type DeSlotKey } from '../domain/double-elimination.js';
import { FORMAT_INFO } from '../domain/formats.js';
import { utcToZoned } from '../format/timezone.js';
import { deSeriesTitle, shortDate, type BracketMatchView, type PublicDoubleElimination, type PublicModel } from './model.js';

// The text shown when a public link is shared (WhatsApp, Telegram, Discord, ...): a title and a description
// derived from the tournament's current state. Dates are the tournament's own (its time zone).

export interface Share {
  title: string;
  description: string;
}

export const NO_TOURNAMENT_SHARE: Share = {
  title: 'Torneos de Dota 2 · jpsolutions',
  description: 'Próximamente: fixture, tabla en vivo y playoffs',
};

const MAX_DESCRIPTION = 200;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** "11 Oct" for an instant, read in the tournament's zone; null when there is none. */
function dayOf(iso: string | null | undefined, timeZone: string): string | null {
  return iso ? shortDate(utcToZoned(iso, timeZone).date) : null;
}

const join = (parts: (string | null | false | undefined)[]): string => parts.filter(Boolean).join(' · ');

const versusOf = (m: BracketMatchView): string | null =>
  m.slots[0].team && m.slots[1].team ? `${m.slots[0].team.name} vs ${m.slots[1].team.name}` : null;

/** The champion and the team that lost the grand final, whatever the format. */
function championOf(model: PublicModel): { champion: Team; runnerUp: Team | null } | null {
  const de = model.doubleElimination;
  const champion = de ? de.champion : model.bracket.champion;
  if (!champion) return null;
  const final = de ? de.grandFinal : model.bracket.final;
  return { champion, runnerUp: final.slots.map((s) => s.team).find((t) => t && t.id !== champion.id) ?? null };
}

/** Double elimination: the grand final once both teams are known, otherwise the progress and the next series. */
function doubleEliminationText(name: string, de: PublicDoubleElimination, timezone: string): Share {
  const finalists = versusOf(de.grandFinal);
  if (finalists) {
    return { title: `${name} · Gran final`, description: join([finalists, dayOf(de.grandFinal.startsAt, timezone)]) };
  }
  // Upper then lower, round by round (the bracket's own order): the first series with both teams and no winner.
  const next = [...de.upper, ...de.lower].flat().find((m) => versusOf(m) && !m.slots.some((s) => s.isWinner));
  return {
    title: `${name} · Torneo de Dota 2`,
    description: join([
      FORMAT_INFO.double_elimination.name,
      de.decided > 0 && `${de.decided}/${de.total} series`,
      next && `Siguiente: ${deSeriesTitleOf(next.key)}: ${versusOf(next)}`,
    ]),
  };
}

const deSeriesTitleOf = (key: DeSlotKey): string => {
  const slot = DE_SLOTS.find((s) => s.key === key)!;
  return deSeriesTitle(slot.phase, slot.matchNumber)!;
};

function stateText(model: PublicModel): Share {
  const name = oneLine(model.name);
  const { bracket, timezone } = model;
  const crowned = championOf(model);

  if (crowned) {
    const champion = crowned.champion.name;
    const runnerUp = crowned.runnerUp;
    return {
      title: `${name} · 🏆 Campeón: ${champion}`,
      description: runnerUp ? `${champion} venció a ${runnerUp.name} en la gran final` : `${champion} es el campeón`,
    };
  }

  if (model.doubleElimination) return doubleEliminationText(name, model.doubleElimination, timezone);

  if (!bracket.projection) {
    const [sf1, sf2] = bracket.semifinals;
    const versus = (m: typeof sf1) => (m.slots[0].team && m.slots[1].team ? `${m.slots[0].team.name} vs ${m.slots[1].team.name}` : null);
    const finalDay = dayOf(bracket.final.startsAt, timezone);
    const finalists = versus(bracket.final);
    if (finalists) {
      return { title: `${name} · Gran final`, description: join([finalists, finalDay]) };
    }
    return {
      title: `${name} · Semifinales`,
      description: join([versus(sf1), versus(sf2), finalDay && `Final el ${finalDay}`]),
    };
  }

  const played = model.progress.played;
  const leader = played > 0 ? model.standings[0] : undefined;
  const firstDay = model.days.find((d) => d.date !== null)?.date;
  const semisDay = dayOf(bracket.semifinals[0].startsAt, timezone);
  return {
    title: `${name} · Torneo de Dota 2`,
    description: join([
      'Fase de grupos',
      model.progress.total > 0 && `${played}/${model.progress.total} partidos`,
      leader && leader.played > 0 && `Líder: ${leader.team.name} (${leader.points} ${leader.points === 1 ? 'pt' : 'pts'})`,
      played === 0 ? firstDay && `Empieza el ${shortDate(firstDay)}` : semisDay && `Semis el ${semisDay}`,
    ]),
  };
}

/** Title and description for a tournament page, or the fixed copy when there is no tournament. */
export function buildShare(model: PublicModel | null): Share {
  if (!model) return NO_TOURNAMENT_SHARE;
  const state = stateText(model);
  const finished = championOf(model) !== null;
  const liveRound = finished ? undefined : model.days.flatMap((d) => d.rounds).find((r) => r.status === 'live');

  // The admin marked a game as being played: say who is playing, before anything derived from the schedule.
  if (model.live.length > 0 && !finished) {
    const [first] = model.live;
    const onStream = model.live.find((l) => l.inStream);
    const versus = (l: typeof first) => `${l!.teamA.name} vs ${l!.teamB.name}`;
    const playing =
      model.live.length === 1
        ? `En juego: ${versus(first)}`
        : `${model.live.length} partidas en juego${onStream ? ` · En transmisión: ${versus(onStream)}` : ''}`;
    return {
      title: clip(oneLine(`🔴 EN VIVO · ${state.title}`), 200),
      description: clip(model.stream && model.live.length === 1 ? `${playing} · Míralo en vivo en ${model.stream.label}` : playing, MAX_DESCRIPTION),
    };
  }
  if (liveRound && model.stream) {
    return {
      title: clip(oneLine(`🔴 EN VIVO · ${state.title}`), 200),
      description: clip(`Ronda ${liveRound.number} en juego · Míralo en vivo en ${model.stream.label}`, MAX_DESCRIPTION),
    };
  }
  return { title: oneLine(state.title), description: clip(oneLine(state.description), MAX_DESCRIPTION) };
}
