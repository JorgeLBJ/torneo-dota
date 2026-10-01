import type { FC, PropsWithChildren } from 'hono/jsx';
import { raw } from 'hono/html';
import { useContext } from 'hono/jsx';
import type { Team } from '../db/repository.js';
import { assetUrl } from '../assets.js';
import type { EmblemSources } from '../domain/emblem.js';
import { EmblemPicture, EmblemSourcesContext, hasPicture } from '../emblem-view.js';
import { emblemSourcesFor } from '../emblem-sources.js';
import type {
  BracketMatchView,
  BracketSlotView,
  PublicDay,
  PublicLive,
  PublicMatch,
  PublicModel,
  PublicRound,
  PublicSeries,
  PublicStandingRow,
} from './model.js';

const FONTS =
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800;900&family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap';

/** Tab keys double as the URL hash, so a shared link opens the right tab. */
export const TABS = [
  { key: 'partidos', label: 'Partidos' },
  { key: 'envivo', label: 'En vivo' },
  { key: 'posiciones', label: 'Posiciones' },
  { key: 'playoffs', label: 'Playoffs' },
  { key: 'reglas', label: 'Reglas' },
] as const;

const PALETTE = ['#c8aa6e', '#6dbf4b', '#d2452f', '#6fa8ff', '#c58cff', '#62d0e0', '#ff9a5c'];

export interface PageLinks {
  /** SSE endpoint for live updates. */
  events: string;
  /** Endpoint returning the page content fragment. */
  partial: string;
}

/** What goes in <head> for sharing and search; every value is printed escaped. */
export interface PageMeta {
  title: string;
  description: string;
  /** Absolute canonical URL of this page. */
  url: string;
  /** Absolute URL of the share image. */
  imageUrl: string;
  /** Ask search engines not to index the page (404). */
  noindex?: boolean;
}

const SITE_NAME = 'torneo-dota · jpsolutions';
const IMAGE_ALT = 'Torneo de Dota 2: Radiant vs Dire';

export const PublicDocument: FC<PropsWithChildren<{ meta: PageMeta; links?: PageLinks }>> = ({ meta, links, children }) => (
  <>
    {raw('<!doctype html>')}
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#07080a" />
        <title>{meta.title}</title>
        <meta name="description" content={meta.description} />
        {meta.noindex ? <meta name="robots" content="noindex" /> : null}
        <link rel="canonical" href={meta.url} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE_NAME} />
        <meta property="og:locale" content="es_ES" />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.description} />
        <meta property="og:url" content={meta.url} />
        <meta property="og:image" content={meta.imageUrl} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:type" content="image/jpeg" />
        <meta property="og:image:alt" content={IMAGE_ALT} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={meta.title} />
        <meta name="twitter:description" content={meta.description} />
        <meta name="twitter:image" content={meta.imageUrl} />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href={assetUrl('img/apple-touch-icon.png')} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link rel="stylesheet" href={FONTS} />
        <link rel="stylesheet" href={assetUrl('site.css')} />
        <link rel="stylesheet" href={assetUrl('rulebook.css')} />
        <noscript>{raw('<style>.panel{display:grid!important}.tabs-bar{display:none}</style>')}</noscript>
      </head>
      <body>
        <div id="app" data-events={links?.events} data-partial={links?.partial}>
          {children}
        </div>
        <footer>
          <div>Resultados oficiales del torneo · Dota 2 es una marca de Valve Corporation</div>
          <div class="credit">
            torneo-dota · powered by{' '}
            <a href="https://jpsolutions.app" target="_blank" rel="noopener">
              jpsolutions
            </a>
          </div>
        </footer>
        <dialog id="matchDetail" class="detail" aria-labelledby="mdTitle">
          <button type="button" class="d-close" data-detail-close aria-label="Cerrar">
            ×
          </button>
          <div id="mdContent" class="d-content"></div>
        </dialog>
        <script src={assetUrl('site-core.js')} defer></script>
        <script src={assetUrl('match-detail.js')} defer></script>
        <script src={assetUrl('site.js')} defer></script>
      </body>
    </html>
  </>
);

/** The emblem of a team (its own image, else its hero portrait), or its code on a neutral tile when no hero was picked. */
const Portrait: FC<{ team: Team | null; cls?: string }> = ({ team, cls = '' }) =>
  team && hasPicture(team, useContext(EmblemSourcesContext)) ? (
    <EmblemPicture team={team} cls={cls} />
  ) : (
    <span class={`ph ${cls}`} style={team ? `--tc:${PALETTE[team.id % PALETTE.length]}` : undefined}>
      {team ? team.code : '?'}
    </span>
  );

const defaultSources = emblemSourcesFor(null);

const teamName = (team: Team | null) => team?.name ?? 'Por definir';

/**
 * Attributes that let a team name shrink to fit its box instead of breaking in the middle of a word: the length of
 * its longest word (the CSS sizes the font from it and the box width) and the full name as a tooltip.
 */
const fitName = (name: string) => ({
  class: /\s/.test(name.trim()) ? 'fit' : 'fit one',
  title: name,
  style: `--n:${Math.max(1, ...name.split(/\s+/).map((word) => word.length))}`,
});

// ---------- Live game ----------

/** "23 min" (or "1 h 05 min") between the mark and the server's clock. */
export function elapsedText(startedAt: string, nowIso: string): string {
  if (Number.isNaN(Date.parse(startedAt)) || Number.isNaN(Date.parse(nowIso))) return '';
  const minutes = Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(startedAt)) / 60000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** The red pulsing pill: "En juego" (plus the game of a series, e.g. "En juego · J3"); violet when on the stream. */
const NowPill: FC<{ game?: number | null; tv?: boolean }> = ({ game = null, tv = false }) =>
  tv ? (
    <span class="now-pill tv">📺 En transmisión{game !== null ? ` · J${game}` : ''}</span>
  ) : (
    <span class="now-pill">
      <span class="now-dot"></span>En juego{game !== null ? ` · J${game}` : ''}
    </span>
  );

/** Shown on every tab while games are live: who is playing (or how many) and where to watch (the stream, else the cards). */
const LiveNotice: FC<{ model: PublicModel }> = ({ model }) => {
  const { live } = model;
  const [first] = live;
  if (!first) return null;
  const href = model.stream ? '#envivo' : first.phase === 'group' ? '#partidos' : '#playoffs';
  return (
    <a class="live-notice" href={href}>
      <span>
        {live.length === 1 ? `🔴 En juego: ${first.teamA.name} vs ${first.teamB.name}` : `🔴 ${live.length} partidas en juego`}
      </span>
      <b>{model.stream ? 'Ver en vivo' : live.length === 1 ? 'Ver partido' : 'Ver partidos'}</b>
    </a>
  );
};

const LiveTeam: FC<{ team: Team; side: 'a' | 'b' }> = ({ team, side }) => (
  <div class={`lr-team ${side}`}>
    <div class="lr-emb">
      <Portrait team={team} />
    </div>
    <div class="lr-name">
      <strong {...fitName(team.name)}>{team.name}</strong>
    </div>
  </div>
);

/** One compact row per live match; the one on the stream is violet. */
const LiveRow: FC<{ live: PublicLive; now: string }> = ({ live, now }) => {
  const { series, teamA, teamB } = live;
  const elapsed = elapsedText(live.startedAt, now);
  return (
    <div class={`lrow ${live.inStream ? 'tv' : ''}`}>
      <div class="lr-meta">
        <NowPill tv={live.inStream} />
        <span class="lr-phase">{live.label}</span>
      </div>
      <LiveTeam team={teamA} side="a" />
      <div class="lr-score">
        {series ? (
          <>
            <span>{series.wins[0]}</span>
            <i>–</i>
            <span>{series.wins[1]}</span>
          </>
        ) : (
          <i>vs</i>
        )}
      </div>
      <LiveTeam team={teamB} side="b" />
      {elapsed ? (
        <div class="lr-el">
          Empezó hace <b data-live-start={live.startedAt}>{elapsed}</b>
        </div>
      ) : null}
    </div>
  );
};

const LiveList: FC<{ live: PublicLive[]; now: string }> = ({ live, now }) => (
  <div class="live-list">
    {live.map((item) => (
      <LiveRow live={item} now={now} />
    ))}
  </div>
);

// ---------- Hero ----------

const Hero: FC<{ model: PublicModel }> = ({ model }) => (
  <header class="hero">
    <div class="wrap hero-inner">
      <span class="live">
        <b></b> En vivo · actualizado al instante
      </span>
      <span class="kicker">{model.kicker}</span>
      <h1>{model.name}</h1>
      <div class="sides">
        <span class="r">Radiant</span>
        <i>vs</i>
        <span class="d">Dire</span>
      </div>
      <div class="phases">
        {model.phases.map((phase) => (
          <div class={phase.current ? 'cur' : ''}>
            <small>{phase.label}</small>
            <b>{phase.dates}</b>
          </div>
        ))}
      </div>
      <div
        class="prog"
        role="progressbar"
        aria-label="Progreso de la fase de grupos"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={model.progress.percent}
      >
        <i style={`width:${model.progress.percent}%`}></i>
      </div>
      <LiveNotice model={model} />
    </div>
  </header>
);

const Section: FC<{ title: string; sub?: string }> = ({ title, sub }) => (
  <div class="sec">
    <h2>{title}</h2>
    {sub ? <span>{sub}</span> : null}
  </div>
);

// ---------- Matches ----------

const MatchSide: FC<{ team: Team | null; side: 'a' | 'b'; match: PublicMatch; index: 0 | 1 }> = ({ team, side, match, index }) => {
  const result = match.played ? (team !== null && team.id === match.winnerId ? 'win' : 'lose') : '';
  const detail =
    match.kills && match.deaths ? `K ${match.kills[index]} · D ${match.deaths[index]}` : team?.captain ? `Cap. ${team.captain}` : '';
  return (
    <div class={`side ${side} ${result}`}>
      <div class="portrait">
        <Portrait team={team} />
        {result === 'win' ? <span class="crown">Victoria</span> : null}
      </div>
      <div class="who">
        <strong {...fitName(teamName(team))}>{teamName(team)}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
};

/** "Ver detalle de la partida": only when a game of the match was imported from Dota. */
const DetailButton: FC<{ url: string }> = ({ url }) => (
  <button type="button" class="detail-btn" data-detail-url={url}>
    ▸ Ver detalle de la partida
  </button>
);

/** One small result per game of a series: J1 AA, J2 BB... */
const GameChips: FC<{ series: PublicSeries; teamA: Team | null; teamB: Team | null }> = ({ series, teamA, teamB }) => (
  <div class="games" aria-label="Resultados por juego">
    {series.games.map((g) => {
      const team = g.winnerId === teamA?.id ? teamA : teamB;
      return (
        <span class={`g ${g.winnerId === teamA?.id ? 'a' : 'b'}`} title={`Juego ${g.number}: ganó ${team?.name ?? ''}`}>
          J{g.number} <b>{team?.code ?? ''}</b>
        </span>
      );
    })}
  </div>
);

const MatchCard: FC<{ match: PublicMatch; time: string | null; live: boolean; detailBase: string }> = ({ match, time, live, detailBase }) => {
  const aWon = match.winnerId !== null && match.winnerId === match.teamA?.id;
  const series = match.series;
  // A match of several games shows its series score; a single game shows 1 - 0 as always.
  const scoreA = series ? series.wins[0] : aWon ? 1 : 0;
  const scoreB = series ? series.wins[1] : aWon ? 0 : 1;
  const running = series !== null && !match.played && series.games.length > 0;
  const teamIds = [match.teamA?.id, match.teamB?.id].filter((id) => id !== undefined).join(' ');
  return (
    <article class={`match ${match.isNext ? 'is-next' : ''} ${live ? 'is-live' : ''} ${match.liveGame !== null ? (match.inStream ? 'on-air tv' : 'on-air') : ''}`} data-teams={teamIds} id={`m-${match.id}`}>
      {match.liveGame !== null ? <NowPill game={match.series ? match.liveGame : null} tv={match.inStream} /> : null}
      <MatchSide team={match.teamA} side="a" match={match} index={0} />
      {match.played || running ? (
        <div class="mid">
          {match.isTiebreak ? <span class="tag extra">Juego adicional</span> : null}
          {running ? <span class="tag live">Serie en juego</span> : null}
          <div class="res">
            <span class={match.played ? (aWon ? 'w' : 'l') : 'n'}>{scoreA}</span>
            <i>–</i>
            <span class={match.played ? (aWon ? 'l' : 'w') : 'n'}>{scoreB}</span>
          </div>
          <small>Partido {match.number}</small>
        </div>
      ) : (
        <div class="mid">
          {match.isTiebreak ? <span class="tag extra">Juego adicional</span> : null}
          <span class="vs">VS</span>
          {time ? (
            <span class="time" data-start={match.startsAt ?? undefined}>
              {time}
            </span>
          ) : null}
          <small>Partido {match.number}</small>
        </div>
      )}
      <MatchSide team={match.teamB} side="b" match={match} index={1} />
      {series && series.games.length > 0 ? <GameChips series={series} teamA={match.teamA} teamB={match.teamB} /> : null}
      {match.hasDetail ? <DetailButton url={`${detailBase}/${match.id}/detalle`} /> : null}
    </article>
  );
};

const RoundBlock: FC<{ round: PublicRound; detailBase: string }> = ({ round, detailBase }) => (
  <div class="round" data-matches={round.matches.length} data-bye={round.bye?.id} data-start={round.startsAt ?? undefined}>
    <div class="round-head">
      <b>Ronda {round.number}</b>
      {round.startTime ? (
        <span class="when" data-start={round.startsAt ?? undefined} data-end={round.endsAt ?? undefined}>
          {round.endTime ? `${round.startTime} – ${round.endTime}` : round.startTime}
        </span>
      ) : null}
      {round.status === 'live' ? <span class="tag live">En juego</span> : null}
      {round.status === 'next' ? <span class="tag next">Siguiente</span> : null}
      {round.status === 'done' ? <span class="tag done">Finalizada</span> : null}
      {round.bye ? (
        <span class="rest">
          Descansa <Portrait team={round.bye} /> {round.bye.name}
        </span>
      ) : null}
    </div>
    <div class="matches">
      {round.matches.map((match) => (
        <MatchCard match={match} time={round.startTime} live={round.status === 'live'} detailBase={detailBase} />
      ))}
    </div>
  </div>
);

/**
 * Rounds and their day headings form one flat, chronological list: the browser regroups it by the
 * visitor's own calendar day (a late match can fall on the next day elsewhere), the server groups by the
 * tournament's zone as the no-JavaScript fallback.
 */
const DayList: FC<{ days: PublicDay[]; detailBase: string }> = ({ days, detailBase }) => (
  <>
    {days.map((day) => (
      <>
        <div class="sec day-head" data-day={day.date ?? undefined}>
          <h2>{day.label}</h2>
          <span>Fase de grupos</span>
        </div>
        {day.rounds.map((round) => (
          <RoundBlock round={round} detailBase={detailBase} />
        ))}
      </>
    ))}
  </>
);

const MatchesPanel: FC<{ model: PublicModel }> = ({ model }) => (
  <>
    <div class="filter">
      <button type="button" class="chip all" aria-pressed="true" data-filter="">
        Todos
      </button>
      {model.teams.map((team) => (
        <button type="button" class="chip" aria-pressed="false" data-filter={team.id}>
          <Portrait team={team} />
          {team.name}
        </button>
      ))}
    </div>
    <p class="tznote" data-tz-note data-tz={model.timezone}>
      Horarios en hora de {model.timezone}
    </p>
    <div class="days">
      {model.days.length === 0 ? <p class="empty">El fixture todavía no está publicado.</p> : null}
      <DayList days={model.days} detailBase={model.detailBase} />
    </div>
  </>
);

// ---------- Live stream ----------

// The player is a direct child of its panel and has a stable `data-embed`, so site.js can keep the very same
// iframe element across live refreshes (moving or re-creating an iframe would restart the video).
const StreamPanel: FC<{ model: PublicModel }> = ({ model }) => {
  const { stream } = model;
  const onStream = model.live.find((l) => l.inStream);
  return (
    <>
      <Section title="En vivo" sub={stream?.label} />
      {model.live.length > 0 ? <LiveList live={model.live} now={model.serverNow} /> : null}
      {stream ? (
        <>
          {onStream ? (
            <p class="stream-now">
              <span class="now-pill tv">
                📺 En transmisión: {onStream.teamA.name} vs {onStream.teamB.name}
              </span>
            </p>
          ) : null}
          <div class="stream-frame" data-stream-frame data-embed={stream.embedUrl}>
            <iframe
              src={stream.embedUrl}
              title={`Transmisión en vivo en ${stream.label}`}
              allow="autoplay; fullscreen; picture-in-picture"
              allowfullscreen
              loading="lazy"
              referrerpolicy="strict-origin-when-cross-origin"
            ></iframe>
          </div>
          <p class="stream-foot">
            <span class="stream-hint">
              ¿No ves la transmisión? Desactiva tu bloqueador de anuncios o ábrela en{' '}
              <a href={stream.openUrl} target="_blank" rel="noopener">
                {stream.label}
              </a>
              .
            </span>
          </p>
        </>
      ) : (
        <div class="stream-empty">
          <strong>Transmisión no disponible</strong>
          <span>Cuando haya transmisión en vivo aparecerá aquí.</span>
        </div>
      )}
    </>
  );
};

// ---------- Standings ----------

const STATUS_LABEL: Partial<Record<PublicStandingRow['status'], string>> = {
  qualified: 'Clasificado',
  eliminated: 'Eliminado',
  tiebreak: 'Empate sin resolver',
  'extra-pending': 'Pendiente de juego adicional',
};

const StandingRowView: FC<{ row: PublicStandingRow }> = ({ row }) => {
  const status = STATUS_LABEL[row.status];
  return (
    <tr class={`${row.qualifies ? 'q' : ''} ${row.cutLine ? 'cut' : ''}`}>
      <td class="pos">{row.position}</td>
      <td class="l">
        <div class="team">
          <Portrait team={row.team} />
          <div>
            <strong title={row.team.name}>{row.team.name}</strong>
            {status ? (
              <small class={`st ${row.status}`}>{status}</small>
            ) : row.team.captain ? (
              <small>Cap. {row.team.captain}</small>
            ) : null}
          </div>
        </div>
      </td>
      <td>{row.played}</td>
      <td class="opt">{row.wins}</td>
      <td class="opt">{row.losses}</td>
      <td class="pts">{row.points}</td>
      <td class="opt">{row.kills}</td>
      <td class="opt">{row.deaths}</td>
      <td class={row.diff > 0 ? 'pos-d' : row.diff < 0 ? 'neg-d' : ''}>
        {row.diff > 0 ? '+' : ''}
        {row.diff}
      </td>
      <td class="opt">
        <span class="form">
          {row.last5.map((r) => (
            <i class={r}>{r === 'W' ? 'G' : 'P'}</i>
          ))}
        </span>
      </td>
    </tr>
  );
};

const StandingsPanel: FC<{ model: PublicModel }> = ({ model }) => (
  <>
    <Section title="Posiciones" sub={model.standingsSub} />
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th class="l">Equipo</th>
            <th>PJ</th>
            <th class="opt">G</th>
            <th class="opt">P</th>
            <th>Pts</th>
            <th class="opt">Kills</th>
            <th class="opt">Deaths</th>
            <th>K−D</th>
            <th class="opt">Últimos</th>
          </tr>
        </thead>
        <tbody>
          {model.standings.map((row) => (
            <StandingRowView row={row} />
          ))}
        </tbody>
      </table>
    </div>
    <div class="legend">
      <span>
        <b>Victoria</b> {model.rules.pointsWin} · <b>Derrota</b> {model.rules.pointsLoss}
      </span>
      {model.rules.legendTiebreak ? (
        <span>
          <b>Desempate:</b> {model.rules.legendTiebreak}
        </span>
      ) : null}
      <span>
        La línea dorada marca a los <b>{model.rules.qualifiers}</b> que pasan a semifinales
      </span>
    </div>
  </>
);

// ---------- Bracket ----------

const BracketSlot: FC<{ slot: BracketSlotView }> = ({ slot }) =>
  slot.team ? (
    <div class={`slot ${slot.isWinner ? 'win' : ''}`}>
      <Portrait team={slot.team} />
      <div>
        <strong {...fitName(slot.team.name)}>{slot.team.name}</strong>
        <small>{slot.isWinner ? 'Victoria' : slot.seedLabel}</small>
      </div>
      {slot.wins !== null ? (
        <b class="wins" aria-label={`${slot.wins} juegos ganados`}>
          {slot.wins}
        </b>
      ) : null}
    </div>
  ) : (
    <div class="slot tbd">
      <span class="ph">?</span>
      <div>
        <strong>Por definir</strong>
        <small>{slot.seedLabel}</small>
      </div>
    </div>
  );

const BracketMatch: FC<{ match: BracketMatchView; detailBase: string }> = ({ match, detailBase }) => (
  <div class={`bm ${match.liveGame !== null ? (match.inStream ? 'on-air tv' : 'on-air') : ''}`}>
    {match.liveGame !== null ? <NowPill game={match.series ? match.liveGame : null} tv={match.inStream} /> : null}
    <header>
      <span>
        {match.title}
        {match.series ? <em class="bo"> · al mejor de {match.series.length}</em> : null}
      </span>
      {match.when ? (
        <b data-start={match.startsAt ?? undefined} data-format="short">
          {match.when}
        </b>
      ) : null}
    </header>
    <BracketSlot slot={match.slots[0]} />
    <BracketSlot slot={match.slots[1]} />
    {match.hasDetail && match.matchId !== null ? <DetailButton url={`${detailBase}/${match.matchId}/detalle`} /> : null}
  </div>
);

const AegisIcon: FC = () => (
  <svg viewBox="0 0 64 76" aria-hidden="true">
    <defs>
      <linearGradient id="aegis-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f0dcaa" />
        <stop offset="1" stop-color="#8a6d3b" />
      </linearGradient>
    </defs>
    <path d="M32 2 60 12v22c0 18-12 32-28 40C16 66 4 52 4 34V12Z" fill="none" stroke="url(#aegis-g)" stroke-width="3" />
    <path d="M32 14 48 20v14c0 11-7 20-16 25-9-5-16-14-16-25V20Z" fill="url(#aegis-g)" opacity=".85" />
  </svg>
);

const BracketPanel: FC<{ model: PublicModel }> = ({ model }) => {
  const { bracket, phases } = model;
  const semiDates = phases.find((p) => p.key === 'semifinal')?.dates;
  const finalDates = phases.find((p) => p.key === 'final')?.dates;
  return (
    <>
      <Section title="Playoffs" sub={`Semis ${semiDates} · Final ${finalDates}`} />
      <div class="notice">{bracket.note}</div>
      <div class="bracket">
        <div class="col">
          <BracketMatch match={bracket.semifinals[0]} detailBase={model.detailBase} />
          <BracketMatch match={bracket.semifinals[1]} detailBase={model.detailBase} />
        </div>
        <div class="link"></div>
        <div class="col">
          <BracketMatch match={bracket.final} detailBase={model.detailBase} />
        </div>
        <div class="link single"></div>
        <div class={`aegis ${bracket.champion ? 'won' : ''}`}>
          <AegisIcon />
          <small>Campeón</small>
          <b>{bracket.champion ? bracket.champion.name : 'Por definir'}</b>
        </div>
      </div>
    </>
  );
};

// ---------- Rules ----------

const RulesPanel: FC<{ model: PublicModel }> = ({ model }) => (
  <>
    <Section title="Reglas" sub="Reglamento oficial" />
    <div class="rules-top">
      {model.rules.summary.map((item) => (
        <div class="rule">
          <small>{item.label}</small>
          <b>{item.value}</b>
        </div>
      ))}
    </div>
    <div class="rules-grid">
      <article class="rbox">
        <h3>Desempate</h3>
        {model.rules.tiebreakers.length > 0 ? (
          <ol>
            {model.rules.tiebreakers.map((text) => (
              <li>{text}</li>
            ))}
          </ol>
        ) : (
          <p>Sin criterios de desempate: los equipos con los mismos puntos quedan empatados.</p>
        )}
      </article>
    </div>
    {model.rules.html ? <div class="rules">{raw(model.rules.html)}</div> : null}
  </>
);

// ---------- Page ----------

/** Everything inside #app; also served on its own as the live-update fragment. */
export const PublicContent: FC<{ model: PublicModel; sources?: EmblemSources }> = ({ model, sources }) => (
  <EmblemSourcesContext.Provider value={sources ?? defaultSources}>
    <span hidden data-server-now={model.serverNow}></span>
    <Hero model={model} />
    <div class="tabs-bar">
      <nav class="tabs" role="tablist" aria-label="Secciones">
        {TABS.map((tab, i) => (
          <button type="button" class="tab" role="tab" aria-selected={i === 0 ? 'true' : 'false'} data-tab={tab.key}>
            {tab.label}
            {tab.key === 'envivo' && model.stream ? <span class="tab-dot" role="img" aria-label="Transmisión activa"></span> : null}
          </button>
        ))}
      </nav>
    </div>
    <main class="wrap">
      <section class="panel on" id="p-partidos" role="tabpanel" data-panel="partidos">
        <MatchesPanel model={model} />
      </section>
      <section class="panel" id="p-envivo" role="tabpanel" data-panel="envivo">
        <StreamPanel model={model} />
      </section>
      <section class="panel" id="p-posiciones" role="tabpanel" data-panel="posiciones">
        <StandingsPanel model={model} />
      </section>
      <section class="panel" id="p-playoffs" role="tabpanel" data-panel="playoffs">
        <BracketPanel model={model} />
      </section>
      <section class="panel" id="p-reglas" role="tabpanel" data-panel="reglas">
        <RulesPanel model={model} />
      </section>
    </main>
  </EmblemSourcesContext.Provider>
);

export const ComingSoonContent: FC = () => (
  <header class="hero hero-min">
    <div class="wrap hero-inner">
      <span class="live">
        <b></b> En vivo · actualizado al instante
      </span>
      <span class="kicker">Dota 2</span>
      <h1>Próximamente</h1>
      <p class="lede">El próximo torneo se publicará aquí muy pronto.</p>
    </div>
  </header>
);

export const NotFoundContent: FC = () => (
  <header class="hero hero-min">
    <div class="wrap hero-inner">
      <span class="kicker">Error 404</span>
      <h1>Torneo no encontrado</h1>
      <p class="lede">
        No existe un torneo con esa dirección. <a href="/">Ir a la portada</a>
      </p>
    </div>
  </header>
);
