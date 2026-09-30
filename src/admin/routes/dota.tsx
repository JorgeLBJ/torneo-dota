import { Hono } from 'hono';
import { gameFromSnapshot, lookupDotaMatch, radiantTeamFor, snapshotSummary } from '../../dota/import.js';
import type { AdminEnv, Deps } from '../context.js';
import { readBody, str } from '../form.js';

/**
 * Dota lookups for the result forms. They run on the server (the browser never talks to the data provider),
 * answer JSON, and are limited per admin so a stuck button cannot hammer the provider.
 */
export function dotaRoutes(deps: Deps) {
  const app = new Hono<AdminEnv>();
  const { repo } = deps;

  const limited = (adminId: number) => !deps.uploadLimiter.consume(`dota:${adminId}`);

  app.post('/dota/buscar', async (c) => {
    if (limited(c.get('admin').id)) return c.json({ error: 'Demasiadas consultas seguidas: espera un minuto.' }, 429);
    const body = await readBody(c);
    const found = await lookupDotaMatch(deps.dota, str(body, 'dota_match_id'));
    if (!found.ok) return c.json({ error: found.error }, 400);
    const snapshot = found.value;
    return c.json({
      ok: true,
      summary: snapshotSummary(snapshot),
      matchId: snapshot.matchId,
      radiantWin: snapshot.radiantWin,
      radiantScore: snapshot.radiantScore,
      direScore: snapshot.direScore,
      durationSec: snapshot.durationSec,
    });
  });

  app.post('/dota/autocompletar', async (c) => {
    const tournament = c.get('tournament');
    if (limited(c.get('admin').id)) return c.json({ error: 'Demasiadas consultas seguidas: espera un minuto.' }, 429);
    const body = await readBody(c);
    const id = (key: string): number | null => {
      const value = str(body, key);
      return /^\d+$/.test(value) ? Number(value) : null;
    };
    const team1 = id('team1_id');
    const team2 = id('team2_id');
    const winner = id('winner');
    const own = new Set(repo.listTeams(tournament.id).map((team) => team.id));
    if (team1 === null || team2 === null || team1 === team2 || !own.has(team1) || !own.has(team2)) {
      return c.json({ error: 'El partido todavía no tiene los dos equipos definidos.' }, 400);
    }
    if (winner !== team1 && winner !== team2) {
      return c.json({ error: 'Indica quién ganó la partida (pulsa «Buscar» y elige).' }, 400);
    }
    const found = await lookupDotaMatch(deps.dota, str(body, 'dota_match_id'));
    if (!found.ok) return c.json({ error: found.error }, 400);
    const radiant = radiantTeamFor(found.value, winner, team1, team2);
    return c.json({ ok: true, summary: snapshotSummary(found.value), ...gameFromSnapshot(found.value, radiant, team1, team2) });
  });

  return app;
}
