import { utcToZoned } from '../format/timezone.js';
import { shortDate, type PublicModel } from './model.js';

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

function stateText(model: PublicModel): Share {
  const name = oneLine(model.name);
  const { bracket, timezone } = model;

  if (bracket.champion) {
    const champion = bracket.champion.name;
    const runnerUp = bracket.final.slots.map((s) => s.team).find((t) => t && t.id !== bracket.champion!.id);
    return {
      title: `${name} · 🏆 Campeón: ${champion}`,
      description: runnerUp ? `${champion} venció a ${runnerUp.name} en la gran final` : `${champion} es el campeón`,
    };
  }

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
  const finished = model.bracket.champion !== null;
  const liveRound = finished ? undefined : model.days.flatMap((d) => d.rounds).find((r) => r.status === 'live');

  // The admin marked a game as being played: say who is playing, before anything derived from the schedule.
  if (model.live && !finished) {
    const playing = `En juego: ${model.live.teamA.name} vs ${model.live.teamB.name}`;
    return {
      title: clip(oneLine(`🔴 EN VIVO · ${state.title}`), 200),
      description: clip(model.stream ? `${playing} · Míralo en vivo en ${model.stream.label}` : playing, MAX_DESCRIPTION),
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
