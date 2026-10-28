'use client';

import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CaretRightIcon,
  EqualsIcon,
  SoccerBallIcon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { LineChart, ShotMap } from '@/components/charts/primitives';
import type { MatchPage } from '@/lib/data/match';
import { formatDateTime, NOT_AVAILABLE } from '@/lib/format';
import { playerMatchValue, teamVsSeason, type TeamStatLine } from '@/lib/match/match';
import { formatStat, type StatDef } from '@/lib/stats/catalog';

// Cara a cara: estadística de Boca y la misma del rival (la posesión del rival es el resto a 100).
const FACE_OFF: [string, string, string][] = [
  ['eq_posesion', 'resto', 'Posesión'],
  ['eq_xg', 'eq_xg_contra', 'xG'],
  ['eq_remates', 'eq_remates_contra', 'Remates'],
  ['eq_remates_arco', 'eq_remates_arco_contra', 'Remates al arco'],
  ['eq_ocasiones_claras', 'eq_ocasiones_claras_contra', 'Ocasiones claras'],
  ['eq_pases', 'eq_pases_contra', 'Pases'],
  ['eq_corners', 'eq_corners_contra', 'Córners'],
  ['eq_faltas', 'eq_faltas_recibidas', 'Faltas'],
  ['eq_amarillas', 'eq_amarillas_rival', 'Amarillas'],
  ['eq_rojas', 'eq_rojas_rival', 'Rojas'],
];

// Columnas de la tabla de jugadores (ids del catálogo).
const PLAYER_COLUMNS = [
  'minutos',
  'calificacion',
  'goles',
  'asistencias',
  'remates',
  'remates_arco',
  'xg',
  'xa',
  'pases_clave',
  'pct_pases',
  'regates_exitosos',
  'duelos_ganados',
  'entradas',
  'intercepciones',
  'recuperaciones',
  'perdidas',
  'faltas_cometidas',
  'amarillas',
  'rojas',
  'atajadas',
];

// Grupos del equipo que no dicen nada de un solo partido (rachas, tabla, conteos de resultados).
const SKIP_GROUPS = new Set([
  'Resultados',
  'Forma y rachas',
  'Tabla de posiciones y Boca vs liga',
  'Local y visitante',
]);

const LINE_ORDER = ['Arquero', 'Defensa', 'Centrocampista', 'Mediocampista', 'Volante', 'Delantero', 'Centro'];
const lineRank = (position: string | null) => {
  const i = LINE_ORDER.findIndex((l) => position?.startsWith(l));
  return i < 0 ? LINE_ORDER.length : i;
};

const day = (iso: string) => iso.split('-').reverse().join('/');

/** Página de un partido de Boca: ficha, goles, cara a cara, jugadores y estadísticas contra la temporada. */
export function MatchView({ data }: { data: MatchPage }) {
  const router = useRouter();
  const { match } = data;
  const teamById = useMemo(() => new Map(data.teamCatalog.map((s) => [s.id, s])), [data.teamCatalog]);
  const playerById = useMemo(() => new Map(data.playerCatalog.map((s) => [s.id, s])), [data.playerCatalog]);
  const outcome =
    match.goalsFor > match.goalsAgainst ? 'Victoria' : match.goalsFor < match.goalsAgainst ? 'Derrota' : 'Empate';
  const home = match.home
    ? { name: 'Boca Juniors', goals: match.goalsFor }
    : { name: match.opponent, goals: match.goalsAgainst };
  const away = match.home
    ? { name: match.opponent, goals: match.goalsAgainst }
    : { name: 'Boca Juniors', goals: match.goalsFor };

  const lines = useMemo(
    () =>
      teamVsSeason(
        match,
        data.season,
        data.teamCatalog.filter(
          (s) => s.available && s.rule !== 'perfil' && s.rule !== 'nd' && !SKIP_GROUPS.has(s.group),
        ),
        teamById,
      ).filter((l) => l.value !== null),
    [match, data.season, data.teamCatalog, teamById],
  );
  const groups = useMemo(() => {
    const out = new Map<string, TeamStatLine[]>();
    for (const l of lines) out.set(l.stat.group, [...(out.get(l.stat.group) ?? []), l]);
    return [...out.entries()];
  }, [lines]);

  const faceOff = FACE_OFF.flatMap(([mine, theirs, label]) => {
    const a = match.stats[teamById.get(mine)?.arg1 ?? mine];
    const b =
      theirs === 'resto' ? (a === undefined ? undefined : 100 - a) : match.stats[teamById.get(theirs)?.arg1 ?? theirs];
    const stat = teamById.get(mine);
    return a === undefined || b === undefined || !stat ? [] : [{ label, a, b, stat }];
  });

  const columns = PLAYER_COLUMNS.flatMap((id) => {
    const s = playerById.get(id);
    return s ? [s] : [];
  });
  const lineup = data.lineup.toSorted(
    (a, b) =>
      Number(b.started) - Number(a.started) ||
      (a.started ? lineRank(a.position) - lineRank(b.position) : (a.minuteIn ?? 0) - (b.minuteIn ?? 0)),
  );

  const teamDetail = (statId: string) => `/estadistica/${statId}?entidad=equipo`;
  const playerDetail = (statId: string, playerId: number) =>
    `/estadistica/${statId}?entidad=jugador&id=${String(playerId)}`;

  return (
    <div className="grid gap-8">
      <nav aria-label="Migas de pan" className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <button
          type="button"
          className="chip focus-ring"
          onClick={() => {
            if (window.history.length > 1) router.back();
            else router.push('/equipo');
          }}
        >
          <ArrowLeftIcon size={14} aria-hidden="true" /> Volver
        </button>
        <Link href="/" className="focus-ring hover:text-fg">
          Inicio
        </Link>
        <CaretRightIcon size={12} aria-hidden="true" />
        <Link href="/equipo" className="focus-ring hover:text-fg">
          Equipo
        </Link>
        <CaretRightIcon size={12} aria-hidden="true" />
        <span className="font-semibold text-fg">
          {match.home ? 'vs' : 'en'} {match.opponent}
        </span>
        <span className="ml-auto flex gap-2">
          {data.prev ? (
            <Link href={`/partido/${String(data.prev.id)}`} className="chip focus-ring" title="Partido anterior">
              <ArrowLeftIcon size={14} aria-hidden="true" /> {data.prev.label}
            </Link>
          ) : null}
          {data.next ? (
            <Link href={`/partido/${String(data.next.id)}`} className="chip focus-ring" title="Partido siguiente">
              {data.next.label} <ArrowRightIcon size={14} aria-hidden="true" />
            </Link>
          ) : null}
        </span>
      </nav>

      {/* Marcador y ficha. */}
      <header className="match-head">
        <p className="text-xs font-semibold text-muted">
          {[match.competitionName, data.round, data.kickoff ? formatDateTime(data.kickoff) : day(match.date)]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <div className="match-score">
          <span className="match-score__team">{home.name}</span>
          <span className="match-score__goals tabular">
            {home.goals} <span className="text-muted">-</span> {away.goals}
          </span>
          <span className="match-score__team match-score__team--away">{away.name}</span>
        </div>
        <p
          className={`text-center text-sm font-bold ${outcome === 'Victoria' ? 'value-best' : outcome === 'Derrota' ? 'value-worst' : 'text-muted'}`}
        >
          {outcome} de Boca{match.home ? ' de local' : ' de visitante'}
          {data.penalties ? ` · penales ${String(data.penalties.for)}-${String(data.penalties.against)}` : ''}
        </p>
        <dl className="match-facts">
          <div>
            <dt>Estadio</dt>
            <dd>{match.venue ?? NOT_AVAILABLE}</dd>
          </div>
          <div>
            <dt>Árbitro</dt>
            <dd>{match.referee ?? NOT_AVAILABLE}</dd>
          </div>
          <div>
            <dt>Formación</dt>
            <dd>
              {data.formation
                ? `Boca ${data.formation.boca ?? NOT_AVAILABLE} · rival ${data.formation.rival ?? NOT_AVAILABLE}`
                : NOT_AVAILABLE}
            </dd>
          </div>
          <div>
            <dt>Clima</dt>
            <dd>
              {data.weather && data.weather.temperature !== null
                ? `${String(Math.round(data.weather.temperature))} °C${data.weather.rain ? ` · lluvia ${String(data.weather.rain)} mm` : ''}${data.weather.wind !== null ? ` · viento ${String(Math.round(data.weather.wind))} km/h` : ''}`
                : NOT_AVAILABLE}
            </dd>
          </div>
        </dl>
      </header>

      <div className="match-grid">
        <section aria-labelledby="goles" className="chart-card">
          <h2 id="goles" className="text-base font-bold">
            Goles
          </h2>
          {match.goalsFor + match.goalsAgainst === 0 ? (
            <p className="text-sm text-muted">Sin goles.</p>
          ) : data.goals.length ? (
            <ol className="match-goals">
              {data.goals.map((g, i) => (
                <li
                  key={`${String(g.minute)}-${String(i)}`}
                  className={g.boca ? 'match-goal--boca' : 'match-goal--rival'}
                >
                  <span className="tabular font-bold">
                    {g.minute !== null ? `${String(g.minute)}'` : NOT_AVAILABLE}
                  </span>
                  <SoccerBallIcon size={14} aria-hidden="true" />
                  <span>
                    {g.player}
                    {g.penalty ? ' (penal)' : ''}
                  </span>
                  <span className="text-xs text-muted">{g.boca ? 'Boca' : match.opponent}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">La fuente no informa los minutos de los goles de este partido.</p>
          )}
          {data.goals.length > 0 && data.goals.length < match.goalsFor + match.goalsAgainst ? (
            <p className="text-xs text-muted">
              Faltan {match.goalsFor + match.goalsAgainst - data.goals.length} goles sin remate registrado (por ejemplo,
              en contra).
            </p>
          ) : null}
        </section>

        {faceOff.length ? (
          <section aria-labelledby="cara" className="chart-card">
            <h2 id="cara" className="text-base font-bold">
              Cara a cara
            </h2>
            <ul className="match-faceoff">
              {faceOff.map((f) => {
                const total = f.a + f.b || 1;
                return (
                  <li key={f.label}>
                    <span className="tabular font-bold">{formatStat(f.a, f.stat, false)}</span>
                    <span className="text-center text-xs font-semibold text-muted">{f.label}</span>
                    <span className="tabular text-right font-bold">{formatStat(f.b, f.stat, false)}</span>
                    <span className="match-faceoff__bar" aria-hidden="true">
                      <span style={{ flexGrow: f.a / total }} className="match-faceoff__boca" />
                      <span style={{ flexGrow: f.b / total }} className="match-faceoff__rival" />
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted">
              <span className="chart-key chart-key--box" style={{ background: 'var(--series-1)' }} /> Boca ·{' '}
              <span className="chart-key chart-key--box" style={{ background: 'var(--series-3)' }} /> {match.opponent}
            </p>
          </section>
        ) : null}
      </div>

      {data.momentum.length > 1 || data.shots.length ? (
        <div className="match-grid">
          {data.momentum.length > 1 ? (
            <section aria-labelledby="momentum" className="chart-card">
              <h2 id="momentum" className="text-base font-bold">
                Momentum
              </h2>
              <LineChart
                labels={data.momentum.map((m) => `${String(m.minute)}'`)}
                series={[{ id: 'm', label: 'Boca', slot: 1, values: data.momentum.map((m) => m.value) }]}
                area
                label="Momentum del partido minuto a minuto: arriba domina Boca, abajo el rival"
              />
              <p className="text-xs text-muted">Arriba de 0 domina Boca; abajo, el rival.</p>
            </section>
          ) : null}
          {data.shots.length ? (
            <section aria-labelledby="remates" className="chart-card">
              <h2 id="remates" className="text-base font-bold">
                Remates de Boca
              </h2>
              <ShotMap
                shots={data.shots
                  .filter((s) => s.boca)
                  .map((s) => ({
                    x: s.x,
                    y: s.y,
                    xg: s.xg,
                    goal: s.goal,
                    title: `${s.minute !== null ? `${String(s.minute)}' · ` : ''}${s.player ?? 'Boca'} · xG ${s.xg.toFixed(2).replace('.', ',')}`,
                  }))}
                label={`Remates de Boca contra ${match.opponent}: tamaño según xG, relleno si fue gol`}
              />
            </section>
          ) : null}
        </div>
      ) : null}

      {lineup.length ? (
        <section aria-labelledby="jugadores" className="grid gap-3">
          <h2 id="jugadores" className="text-xl font-bold">
            Jugadores de Boca
          </h2>
          <div className="data-table-wrap match-table">
            <table
              className="data-table tabular"
              onDoubleClick={(e) => {
                // Doble clic en una celda: la estadística desglosada de ese jugador (9.8).
                const cell = (e.target as HTMLElement).closest<HTMLElement>('td[data-stat]');
                const row = cell?.closest<HTMLElement>('tr[data-player]');
                if (cell?.dataset.stat && row?.dataset.player) {
                  router.push(playerDetail(cell.dataset.stat, Number(row.dataset.player)));
                }
              }}
            >
              <caption className="sr-only">
                Jugadores de Boca en el partido. Doble clic en una celda abre la estadística desglosada del jugador.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Jugador</th>
                  <th scope="col">Puesto</th>
                  {columns.map((c) => (
                    <th key={c.id} scope="col" title={c.name}>
                      {c.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lineup.map((p, i) => (
                  <tr
                    key={p.playerId}
                    data-player={p.playerId}
                    className={!p.started && i > 0 ? 'match-sub' : undefined}
                  >
                    <th scope="row">
                      <Link href={`/jugadores?jugador=${String(p.playerId)}`} className="focus-ring hover:underline">
                        {p.shirt !== null ? <span className="text-muted">{p.shirt} </span> : null}
                        {p.name}
                      </Link>
                      {!p.started ? (
                        <span className="ml-1 text-xs text-muted">
                          (entró{p.minuteIn !== null ? ` ${String(p.minuteIn)}'` : ''})
                        </span>
                      ) : null}
                    </th>
                    <td className="text-left text-muted">{p.position ?? NOT_AVAILABLE}</td>
                    {columns.map((c) => {
                      const v = playerMatchValue(p.keys, c, playerById);
                      return (
                        <td key={c.id} data-stat={c.id} className={v === null ? 'text-muted' : undefined}>
                          {v === null ? '—' : formatStat(v, c, false)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="equipo" className="grid gap-3">
        <h2 id="equipo" className="text-xl font-bold">
          Boca en el partido contra su promedio
        </h2>
        <p className="text-sm text-muted">
          Valor del partido y promedio por partido de la temporada (los porcentajes, sobre el total). Verde: mejor que
          su promedio según el sentido de cada estadística. Doble clic en una fila: la estadística desglosada.
        </p>
        <div className="match-stat-groups">
          {groups.map(([group, list]) => (
            <div key={group} className="data-table-wrap">
              <table
                className="data-table tabular"
                onDoubleClick={(e) => {
                  const id = (e.target as HTMLElement).closest<HTMLElement>('tr[data-stat]')?.dataset.stat;
                  if (id) router.push(teamDetail(id));
                }}
              >
                <caption className="match-caption">{group}</caption>
                <thead>
                  <tr>
                    <th scope="col">Estadística</th>
                    <th scope="col">Partido</th>
                    <th scope="col">Promedio</th>
                    <th scope="col">
                      <span className="sr-only">Contra el promedio</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((l) => (
                    <TeamRow key={l.stat.id} line={l} href={teamDetail(l.stat.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>

      {data.absences.length || data.situations.length ? (
        <div className="match-grid">
          {data.absences.length ? (
            <section aria-labelledby="bajas" className="chart-card">
              <h2 id="bajas" className="text-base font-bold">
                Bajas de Boca
              </h2>
              <ul className="grid gap-1 text-sm">
                {data.absences.map((a) => (
                  <li key={a.name}>
                    <span className="font-semibold">{a.name}</span>
                    {a.reason ? <span className="text-muted"> · {a.reason}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data.situations.length ? (
            <section aria-labelledby="situaciones" className="chart-card">
              <h2 id="situaciones" className="text-base font-bold">
                Este partido en Situaciones
              </h2>
              <ul className="match-situations">
                {data.situations.map((s) => (
                  <li key={`${s.cardId}-${s.param}`}>
                    <Link href={`/situaciones#tarjeta-${s.cardId}`} className="focus-ring hover:underline">
                      {s.title}
                    </Link>
                    <span className="text-muted"> · {s.param}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TeamRow({ line, href }: { line: TeamStatLine; href: string }) {
  const s: StatDef = line.stat;
  return (
    <tr data-stat={s.id} title="Doble clic: estadística desglosada">
      <th scope="row">
        <Link href={href} className="focus-ring hover:underline">
          {s.name}
        </Link>
      </th>
      <td className="font-bold">{formatStat(line.value, s, false)}</td>
      <td className="text-muted">{formatStat(line.season, s, true)}</td>
      <td>
        {line.verdict === 'mejor' ? (
          <span className="value-best" title="Mejor que su promedio">
            <ArrowUpIcon size={14} weight="bold" aria-hidden="true" className="inline" />
            <span className="sr-only">mejor</span>
          </span>
        ) : line.verdict === 'peor' ? (
          <span className="value-worst" title="Peor que su promedio">
            <ArrowDownIcon size={14} weight="bold" aria-hidden="true" className="inline" />
            <span className="sr-only">peor</span>
          </span>
        ) : line.verdict === 'igual' ? (
          <span className="text-muted" title="Igual a su promedio">
            <EqualsIcon size={14} aria-hidden="true" className="inline" />
            <span className="sr-only">igual</span>
          </span>
        ) : null}
      </td>
    </tr>
  );
}
