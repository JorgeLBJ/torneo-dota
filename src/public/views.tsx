import type { FC, PropsWithChildren } from 'hono/jsx';
import { raw } from 'hono/html';
import type { Team } from '../db/repository.js';
import { assetUrl } from '../assets.js';
import type { RulebookBlock } from '../markdown.js';
import type {
  BracketMatchView,
  BracketSlotView,
  PublicDay,
  PublicMatch,
  PublicModel,
  PublicRound,
  PublicStandingRow,
} from './model.js';

const FONTS =
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800;900&family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap';

/** Tab keys double as the URL hash, so a shared link opens the right tab. */
export const TABS = [
  { key: 'partidos', label: 'Partidos' },
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

export const PublicDocument: FC<PropsWithChildren<{ title: string; links?: PageLinks }>> = ({ title, links, children }) => (
  <>
    {raw('<!doctype html>')}
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#07080a" />
        <title>{title}</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link rel="stylesheet" href={FONTS} />
        <link rel="stylesheet" href={assetUrl('site.css')} />
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
        <script src={assetUrl('site-core.js')} defer></script>
        <script src={assetUrl('site.js')} defer></script>
      </body>
    </html>
  </>
);

/** Hero portrait of a team, or its code on a neutral tile when no hero was picked. */
const Portrait: FC<{ team: Team | null; cls?: string }> = ({ team, cls = '' }) =>
  team?.hero ? (
    <img class={cls} src={`/assets/heroes/${team.hero}.png`} alt="" loading="lazy" />
  ) : (
    <span class={`ph ${cls}`} style={team ? `--tc:${PALETTE[team.id % PALETTE.length]}` : undefined}>
      {team ? team.code : '?'}
    </span>
  );

const teamName = (team: Team | null) => team?.name ?? 'Por definir';

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
        <strong>{teamName(team)}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
};

const MatchCard: FC<{ match: PublicMatch; time: string | null; live: boolean }> = ({ match, time, live }) => {
  const aWon = match.winnerId !== null && match.winnerId === match.teamA?.id;
  const teamIds = [match.teamA?.id, match.teamB?.id].filter((id) => id !== undefined).join(' ');
  return (
    <article class={`match ${match.isNext ? 'is-next' : ''} ${live ? 'is-live' : ''}`} data-teams={teamIds}>
      <MatchSide team={match.teamA} side="a" match={match} index={0} />
      {match.played ? (
        <div class="mid">
          <div class="res">
            <span class={aWon ? 'w' : 'l'}>{aWon ? 1 : 0}</span>
            <i>–</i>
            <span class={aWon ? 'l' : 'w'}>{aWon ? 0 : 1}</span>
          </div>
          <small>Partido {match.number}</small>
        </div>
      ) : (
        <div class="mid">
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
    </article>
  );
};

const RoundBlock: FC<{ round: PublicRound }> = ({ round }) => (
  <div class="round" data-bye={round.bye?.id} data-start={round.startsAt ?? undefined}>
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
        <MatchCard match={match} time={round.startTime} live={round.status === 'live'} />
      ))}
    </div>
  </div>
);

/**
 * Rounds and their day headings form one flat, chronological list: the browser regroups it by the
 * visitor's own calendar day (a late match can fall on the next day elsewhere), the server groups by the
 * tournament's zone as the no-JavaScript fallback.
 */
const DayList: FC<{ days: PublicDay[] }> = ({ days }) => (
  <>
    {days.map((day) => (
      <>
        <div class="sec day-head" data-day={day.date ?? undefined}>
          <h2>{day.label}</h2>
          <span>Fase de grupos</span>
        </div>
        {day.rounds.map((round) => (
          <RoundBlock round={round} />
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
      <DayList days={model.days} />
    </div>
  </>
);

// ---------- Standings ----------

const STATUS_LABEL: Partial<Record<PublicStandingRow['status'], string>> = {
  qualified: 'Clasificado',
  eliminated: 'Eliminado',
  tiebreak: 'Desempate',
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
            <strong>{row.team.name}</strong>
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
        <strong>{slot.team.name}</strong>
        <small>{slot.isWinner ? 'Victoria' : slot.seedLabel}</small>
      </div>
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

const BracketMatch: FC<{ match: BracketMatchView }> = ({ match }) => (
  <div class="bm">
    <header>
      <span>{match.title}</span>
      {match.when ? (
        <b data-start={match.startsAt ?? undefined} data-format="short">
          {match.when}
        </b>
      ) : null}
    </header>
    <BracketSlot slot={match.slots[0]} />
    <BracketSlot slot={match.slots[1]} />
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
          <BracketMatch match={bracket.semifinals[0]} />
          <BracketMatch match={bracket.semifinals[1]} />
        </div>
        <div class="link"></div>
        <div class="col">
          <BracketMatch match={bracket.final} />
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

interface RuleBox {
  title: string;
  blocks: RulebookBlock[];
}

/** Each `## Heading` opens a box; text before the first heading goes into a "Reglamento" box. */
function toBoxes(blocks: RulebookBlock[]): RuleBox[] {
  const boxes: RuleBox[] = [];
  for (const block of blocks) {
    if (block.type === 'heading') boxes.push({ title: block.text, blocks: [] });
    else {
      if (boxes.length === 0) boxes.push({ title: 'Reglamento', blocks: [] });
      boxes[boxes.length - 1]!.blocks.push(block);
    }
  }
  return boxes;
}

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
        <ol>
          {model.rules.tiebreakers.map((text) => (
            <li>{text}</li>
          ))}
        </ol>
      </article>
      {toBoxes(model.rules.blocks).map((box) => (
        <article class="rbox">
          <h3>{box.title}</h3>
          {box.blocks.map((block) =>
            block.type === 'list' ? (
              <ul>
                {block.items.map((item) => (
                  <li>{item}</li>
                ))}
              </ul>
            ) : block.type === 'paragraph' ? (
              <p>{block.text}</p>
            ) : null,
          )}
        </article>
      ))}
    </div>
  </>
);

// ---------- Page ----------

/** Everything inside #app; also served on its own as the live-update fragment. */
export const PublicContent: FC<{ model: PublicModel }> = ({ model }) => (
  <>
    <Hero model={model} />
    <div class="tabs-bar">
      <nav class="tabs" role="tablist" aria-label="Secciones">
        {TABS.map((tab, i) => (
          <button type="button" class="tab" role="tab" aria-selected={i === 0 ? 'true' : 'false'} data-tab={tab.key}>
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
    <main class="wrap">
      <section class="panel on" id="p-partidos" role="tabpanel" data-panel="partidos">
        <MatchesPanel model={model} />
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
  </>
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
