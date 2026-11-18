'use client';

import { useState } from 'react';

import { ChartCard } from '@/components/charts/chart-card';
import { BarChart, Heatmap, ScatterChart } from '@/components/charts/primitives';
import type { ModelRun, Prediction, StatTest, Strength } from '@/lib/data/models';
import {
  average,
  type Glm,
  lambdas,
  outcomes,
  type Profile,
  scoreMatrix,
  simulate,
  type Venue,
} from '@/lib/models/predictor';

import { dec2, dec3, num, pct, pValue, Section, Tiles, WaitingData } from './common';
import { SortableTable } from './sortable-table';
import { ProbabilityPanel } from './probability-panel';

interface Props {
  team: string;
  run: ModelRun | null;
  predictions: Prediction[];
  strengths: Strength[];
  tests: StatTest[];
}

const SOURCE =
  'Pipeline Pelotheta (resultados: Promiedos, StrikerAPI y transfermarkt-datasets; valor de planteles: transfermarkt-datasets)';
const COMPETITIONS: Record<string, string> = {
  liga: 'Liga Profesional',
  conmebol_copa_libertadores: 'Copa Libertadores',
  conmebol_copa_sudamericana: 'Copa Sudamericana',
  copa_argentina: 'Copa Argentina',
};
const compName = (c: string) => COMPETITIONS[c] ?? c;
const M = (v: number | null) => (v === null ? null : v / 1e6);

interface VariableRow {
  label: string;
  names: string[];
  brier: number | null;
  log_loss: number | null;
}
interface CoefRow {
  id: string;
  label: string;
  coef: number;
  std_err: number;
  p_value: number;
}
const VARIABLE_TEXT: Record<string, string> = {
  ataque: 'Goles que hace (con más peso a lo reciente)',
  defensa: 'Goles que recibe el rival',
  valor: 'Valor del plantel propio contra el del rival',
  elo: 'Elo antes del partido',
  forma: 'Puntos en los últimos 5 partidos',
  local: 'Jugar de local',
};
const COEF_TEXT: Record<string, (b: number) => string> = {
  ataque: (b) => `Si hace el doble de goles que el promedio: ${pct(Math.pow(2, b) - 1)} más goles esperados`,
  defensa: (b) => `Si el rival recibe el doble que el promedio: ${pct(Math.pow(2, b) - 1)} más goles esperados`,
  valor: (b) => `Plantel que vale el doble que el del rival: ${pct(Math.pow(2, b) - 1)} más goles esperados`,
  elo: (b) => `100 puntos de Elo más: ${pct(Math.exp(b / 4) - 1)} más goles esperados`,
  forma: (b) => `Un punto por partido más en la racha: ${pct(Math.exp(b) - 1)} más goles esperados`,
  local: (b) => `De local: ${pct(Math.exp(b) - 1)} más goles esperados`,
};
const goals = (n: number) => Array.from({ length: n }, (_, i) => (i === n - 1 ? `${String(i)}+` : String(i)));

/** Vista desde el equipo elegido: en el escenario de visitante se dan vuelta filas y columnas. */
function fromTeam(p: Prediction, teamIsHome: boolean) {
  const matrix = teamIsHome ? p.matrix : (p.matrix[0] ?? []).map((_, j) => p.matrix.map((row) => row[j] ?? 0));
  return {
    matrix,
    lambdaOwn: teamIsHome ? p.lambdaHome : p.lambdaAway,
    lambdaRival: teamIsHome ? p.lambdaAway : p.lambdaHome,
    win: teamIsHome ? p.pHome : p.pAway,
    draw: p.pDraw,
    loss: teamIsHome ? p.pAway : p.pHome,
    sim: p.sim
      ? {
          win: teamIsHome ? p.sim.p_home : p.sim.p_away,
          draw: p.sim.p_draw,
          loss: teamIsHome ? p.sim.p_away : p.sim.p_home,
          n: p.sim.n,
        }
      : null,
  };
}

function mostLikely(p: Prediction, team: string): 'Ganó' | 'Empató' | 'Perdió' {
  const v = fromTeam(p, p.home === team);
  return v.win >= v.draw && v.win >= v.loss ? 'Ganó' : v.draw >= v.loss ? 'Empató' : 'Perdió';
}

const ZONE = 'zona';
const COUNTRY_MEAN = 'pais';
const LEAGUE_MEAN = 'media';

export function PredictorView({ team, run, predictions, strengths, tests }: Props) {
  const updated = run?.trainedAt ?? null;
  const m = run?.metrics ?? {};
  const glm = (m.glm ?? null) as unknown as Glm | null;
  const leagueElo = num(m.league_elo) ?? 1500;
  const defaultForm = num(m.default_form) ?? 1.35;
  const homeCountry = typeof run?.params.league_country === 'string' ? run.params.league_country : 'Argentina';
  const homeLeague = typeof run?.params.league_name === 'string' ? run.params.league_name : 'Liga Profesional';
  const others = strengths.filter((s) => s.team !== team);
  const countries = [...new Set(others.map((s) => s.country ?? 'Sin datos'))].sort((a, b) =>
    a === homeCountry ? -1 : b === homeCountry ? 1 : a.localeCompare(b, 'es'),
  );
  const leaguesOf = (c: string) =>
    [...new Set(others.filter((s) => (s.country ?? 'Sin datos') === c).map((s) => s.league ?? 'Sin datos'))].sort(
      (a, b) => (a === homeLeague ? -1 : b === homeLeague ? 1 : a.localeCompare(b, 'es')),
    );
  // Por defecto: contra la media de la liga propia.
  const [country, setCountry] = useState(homeCountry);
  const [league, setLeague] = useState(homeLeague);
  const [rival, setRival] = useState(LEAGUE_MEAN);
  const [venue, setVenue] = useState<Venue>('local');
  const ownRow = strengths.find((s) => s.team === team);

  if (!run || run.status !== 'ok' || !glm || !ownRow) {
    return (
      <div className="grid gap-8">
        <WaitingData
          title="El predictor espera resultados de la liga"
          message={run?.message ?? 'Todavía no corrió el pipeline con el paso de modelos.'}
        />
        <Section id="probabilidad" title="Probabilidad del equipo">
          <ProbabilityPanel tests={tests} updated={updated} />
        </Section>
      </div>
    );
  }

  const profileOf = (s: Strength): Profile => ({
    name: s.team,
    attackHome: s.attackHome,
    attackAway: s.attackAway,
    defenseHome: s.defenseHome,
    defenseAway: s.defenseAway,
    value: s.value ?? 1,
    elo: s.elo ?? leagueElo,
    form: s.form ?? defaultForm,
    estimated: s.estimated,
    count: 1,
  });
  const inCountry = (s: Strength) => (s.country ?? 'Sin datos') === country;
  const group =
    country === ZONE
      ? others
      : league === COUNTRY_MEAN
        ? others.filter(inCountry)
        : others.filter((s) => inCountry(s) && (s.league ?? 'Sin datos') === league);
  const clubs = [...group].sort((a, b) => a.team.localeCompare(b.team, 'es'));
  const single = country !== ZONE && league !== COUNTRY_MEAN && rival !== LEAGUE_MEAN;
  const picked = single ? clubs.find((s) => s.team === rival) : undefined;
  const meanLabel =
    country === ZONE ? 'Media de toda la zona' : league === COUNTRY_MEAN ? `Media de ${country}` : `Media de ${league}`;
  const rivalProfile = picked ? profileOf(picked) : average(meanLabel, group.map(profileOf));
  const rivalName = rivalProfile.name;
  const lam = lambdas(glm, profileOf(ownRow), rivalProfile, venue);
  const matrix = scoreMatrix(lam.own, lam.rival);
  const result = outcomes(matrix);
  const sim = simulate(lam.own, lam.rival);
  const view = { matrix, lambdaOwn: lam.own, lambdaRival: lam.rival, ...result, sim };
  const variables = (Array.isArray(m.variables) ? m.variables : []) as unknown as VariableRow[];
  const coefs = (Array.isArray(m.coefs) ? m.coefs : []) as unknown as CoefRow[];
  const chosenSet = typeof m.chosen === 'string' ? m.chosen : '';
  const leagueStrengths = strengths.filter((s) => s.competition === 'liga');
  const size = view.matrix.length;
  const ownPmf = view.matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const rivalPmf = (view.matrix[0] ?? []).map((_, j) => view.matrix.reduce((a, row) => a + (row[j] ?? 0), 0));
  const backtest = predictions.filter((p) => p.kind === 'backtest');
  const calibration = (Array.isArray(m.calibration) ? m.calibration : []) as {
    bin: number;
    predicted: number;
    observed: number | null;
  }[];
  const outcome = (p: Prediction) => {
    if (p.actualHome === null || p.actualAway === null) return null;
    const own = p.home === team ? p.actualHome : p.actualAway;
    const other = p.home === team ? p.actualAway : p.actualHome;
    return own > other ? 'Ganó' : own === other ? 'Empató' : 'Perdió';
  };
  const venueText =
    venue === 'local' ? `${team} de local` : venue === 'visitante' ? `${team} de visitante` : 'cancha neutral';

  return (
    <div className="grid gap-10">
      <Section
        id="partido"
        title="Elegí el rival"
        intro="Por defecto, contra el equipo promedio de la liga. Elegí país, liga y equipo, o quedate con la media de una liga, de un país o de toda la zona. El modelo espera goles para cada uno con lo que hace y recibe (con más peso a lo reciente), el valor de los planteles y la localía. No son cuotas: son probabilidades del modelo."
      >
        <div className="selector-grid">
          <label className="field">
            <span>País del rival</span>
            <select
              className="select"
              value={country}
              onChange={(e) => {
                const c = e.target.value;
                setCountry(c);
                setLeague(c === ZONE ? COUNTRY_MEAN : (leaguesOf(c)[0] ?? COUNTRY_MEAN));
                setRival(LEAGUE_MEAN);
              }}
            >
              <option value={ZONE}>Toda la zona (media)</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Liga</span>
            <select
              className="select"
              value={league}
              disabled={country === ZONE}
              onChange={(e) => {
                setLeague(e.target.value);
                setRival(LEAGUE_MEAN);
              }}
            >
              <option value={COUNTRY_MEAN}>Todas (media del país)</option>
              {country !== ZONE
                ? leaguesOf(country).map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))
                : null}
            </select>
          </label>
          <label className="field">
            <span>Equipo</span>
            <select
              className="select"
              value={rival}
              disabled={country === ZONE || league === COUNTRY_MEAN}
              onChange={(e) => {
                setRival(e.target.value);
              }}
            >
              <option value={LEAGUE_MEAN}>Media de la liga</option>
              {country !== ZONE && league !== COUNTRY_MEAN
                ? clubs.map((s) => (
                    <option key={s.team} value={s.team}>
                      {s.team}
                      {s.estimated ? ' (supuesto)' : ''}
                    </option>
                  ))
                : null}
            </select>
          </label>
          <div className="field">
            <span>Dónde</span>
            <div role="group" aria-label="Localía" className="flex flex-wrap gap-2">
              {(['local', 'visitante', 'neutral'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className="chip focus-ring"
                  aria-pressed={venue === v}
                  onClick={() => {
                    setVenue(v);
                  }}
                >
                  {v === 'local' ? 'Local' : v === 'visitante' ? 'Visitante' : 'Neutral'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-sm text-muted">
          {team} contra <strong>{rivalName}</strong>
          {rivalProfile.count > 1 ? ` (${String(rivalProfile.count)} equipos)` : ''} · {venueText}.
          {rivalProfile.estimated
            ? ' Hay clubes sin datos en las fuentes abiertas: su valor de plantel es un supuesto (el típico de un club de la liga; uno de Primera Nacional, el 40 % del más barato de Primera). Tomalo como orientativo.'
            : ''}
          {picked && picked.competition !== 'liga' && COMPETITIONS[picked.competition]
            ? ` Rival de ${compName(picked.competition)} esta temporada.`
            : ''}
        </p>
        <Tiles
          items={[
            {
              label: `Goles esperados de ${team}`,
              value: dec2(view.lambdaOwn),
              help: 'λ: el promedio de goles que haría si se jugara este partido muchas veces.',
            },
            {
              label: 'Goles esperados del rival',
              value: dec2(view.lambdaRival),
              help: 'λ del rival, con la misma idea.',
            },
            { label: 'Gana', value: pct(view.win) },
            { label: 'Empata', value: pct(view.draw) },
            { label: 'Pierde', value: pct(view.loss) },
            {
              label: 'Marcador más probable',
              value: (() => {
                let best = { i: 0, j: 0, p: -1 };
                view.matrix.forEach((row, i) => {
                  row.forEach((p, j) => {
                    if (p > best.p) best = { i, j, p };
                  });
                });
                return `${String(best.i)} a ${String(best.j)}`;
              })(),
              help: 'La celda más alta de la matriz de marcadores: el resultado exacto más probable (igual es poco probable por sí solo).',
            },
            {
              label: 'Puntos esperados',
              value: dec2(3 * view.win + view.draw),
              help: '3 × P(gana) + 1 × P(empata): los puntos que sacaría en promedio.',
            },
            {
              label: 'Valor de los planteles',
              value: `${dec2(M(ownRow.value))} M €`,
              hint: `Rival: ${dec2(M(rivalProfile.value))} M €${rivalProfile.estimated ? ' (con supuestos)' : ''}`,
              help: 'Suma de los valores de mercado de cada plantel (transfermarkt-datasets); en una media, la media geométrica. Es la variable que más mejoró las predicciones.',
            },
          ]}
        />
        <div className="chart-grid-layout">
          <ChartCard
            id="pred-resultado"
            number="M1"
            title="Gana, empata o pierde: cuenta exacta contra simulación"
            source={SOURCE}
            updated={updated}
            coverage={`Monte Carlo: ${view.sim.n.toLocaleString('es-AR')} partidos simulados`}
            table={{
              head: ['Resultado', 'Exacta', 'Simulación'],
              rows: [
                ['Gana', view.win, view.sim.win],
                ['Empata', view.draw, view.sim.draw],
                ['Pierde', view.loss, view.sim.loss],
              ],
            }}
          >
            <BarChart
              labels={['Gana', 'Empata', 'Pierde']}
              format={(v) => pct(v)}
              series={[
                { id: 'exacta', label: 'Cuenta exacta', slot: 1, values: [view.win, view.draw, view.loss] },
                {
                  id: 'sim',
                  label: 'Frecuencia simulada',
                  slot: 2,
                  values: [view.sim.win, view.sim.draw, view.sim.loss],
                },
              ]}
              label="Probabilidad de ganar, empatar y perder, exacta y simulada"
            />
          </ChartCard>
          <ChartCard
            id="pred-matriz"
            number="M2"
            title={`Marcadores posibles: P(${team} = i, rival = j)`}
            source={SOURCE}
            updated={updated}
            coverage="Cada celda: probabilidad de ese marcador. Se multiplican las de cada equipo porque sus goles se toman independientes"
            table={{
              head: [`${team} \\ ${rivalName}`, ...goals(size)],
              rows: view.matrix.map((row, i) => [String(i), ...row.map((c) => Number((c * 100).toFixed(1)))]),
            }}
          >
            <Heatmap
              rows={goals(size).map((g) => `${team.split(' ')[0] ?? team} ${g}`)}
              cols={goals(size)}
              values={view.matrix.map((row) => row.map((c) => Number((c * 100).toFixed(1))))}
              label={`Probabilidad en porcentaje de cada marcador entre ${team} y ${rivalName}`}
            />
          </ChartCard>
          <ChartCard
            id="pred-marginales"
            number="M3"
            title="Goles de cada equipo"
            source={SOURCE}
            updated={updated}
            coverage={`Distribución de Poisson: el promedio es λ (${dec2(view.lambdaOwn)} y ${dec2(view.lambdaRival)})`}
            table={{
              head: ['Goles', team, rivalName],
              rows: ownPmf.map((p, i) => [String(i), p, rivalPmf[i] ?? 0]),
            }}
          >
            <BarChart
              labels={goals(size)}
              format={(v) => pct(v)}
              series={[
                { id: 'own', label: team, slot: 1, values: ownPmf },
                { id: 'rival', label: rivalName, slot: 2, values: rivalPmf },
              ]}
              label={`Probabilidad de cada cantidad de goles de ${team} y de ${rivalName}`}
            />
          </ChartCard>
        </div>
      </Section>

      <Section
        id="backtest"
        title="¿Acierta? Backtest sin mirar el futuro"
        intro="Cada partido de la liga de este año se predijo solo con los partidos anteriores, incluidos los de temporadas pasadas: un partido de hace seis meses pesa la mitad que uno de hoy. Brier y log-loss: más bajo es mejor. La línea de base predice siempre la frecuencia histórica de local, empate y visitante."
      >
        <Tiles
          items={[
            {
              label: 'Partidos evaluados',
              value: String(num(m.evaluated) ?? 'n/d'),
              help: 'Todos los partidos de liga de este año, cada uno predicho solo con lo que había pasado antes.',
            },
            {
              label: 'Brier del modelo',
              value: dec3(num(m.brier)),
              hint: `Línea de base: ${dec3(num(m.brier_base))}`,
              help: 'Error de las probabilidades: 0 sería acertar todo con 100 % de seguridad. La línea de base predice siempre la frecuencia histórica de local, empate y visitante; cuanto más abajo de ella, mejor.',
            },
            {
              label: 'Log-loss del modelo',
              value: dec3(num(m.log_loss)),
              hint: `Línea de base: ${dec3(num(m.log_loss_base))}`,
              help: 'Otra medida del error que castiga mucho estar muy seguro y equivocarse. Más bajo es mejor.',
            },
            {
              label: 'Goles por partido del local',
              value: dec2(num(m.mu_home)),
              hint: `Visitante: ${dec2(num(m.mu_away))}`,
              help: 'Promedio de la liga (pesado por antigüedad): la base sobre la que se mide a cada equipo.',
            },
          ]}
        />
        <div className="chart-grid-layout">
          <ChartCard
            id="pred-calibracion"
            number="M4"
            title="Calibración: lo que se predijo contra lo que pasó"
            source={SOURCE}
            updated={updated}
            coverage="Sobre la diagonal, el modelo dice 40 % y pasa el 40 % de las veces"
            table={{
              head: ['Probabilidad predicha', 'Predicciones', 'Frecuencia observada'],
              rows: calibration.map((c) => [
                `${String(c.bin * 100)}–${String(c.bin * 100 + 10)} %`,
                c.predicted,
                c.observed,
              ]),
            }}
          >
            <ScatterChart
              points={calibration
                .filter((c) => c.observed !== null)
                .map((c) => ({
                  x: c.bin + 0.05,
                  y: c.observed ?? 0,
                  label: `${String(c.bin * 100)}–${String(c.bin * 100 + 10)} % (${String(c.predicted)} predicciones)`,
                  size: Math.min(1, c.predicted / 300),
                }))}
              xLabel="Probabilidad predicha"
              yLabel="Frecuencia observada"
              diagonal
              label="Calibración del predictor de partidos"
            />
          </ChartCard>
          <ChartCard
            id="pred-fuerzas"
            number="M5"
            title="Ataque y defensa de cada club (1 = promedio de la liga)"
            source={SOURCE}
            updated={updated}
            coverage="Defensa: goles recibidos contra el promedio, más bajo es mejor"
            table={{
              head: ['Club', 'Ataque', 'Defensa', 'GF', 'GC', 'Valor del plantel (M €)'],
              rows: [...leagueStrengths]
                .sort((a, b) => b.attack - a.attack)
                .map((s) => [s.team, s.attack, s.defense, s.goalsFor, s.goalsAgainst, M(s.value)]),
            }}
          >
            <ScatterChart
              points={leagueStrengths.map((s) => ({
                x: s.attack,
                y: s.defense,
                label: s.team,
                slot: s.team === team ? 1 : 4,
              }))}
              groups={[
                { label: team, slot: 1 },
                { label: 'Resto de la liga', slot: 4 },
              ]}
              xLabel="Ataque"
              yLabel="Defensa (más bajo, mejor)"
              medians
              label="Fuerza de ataque y de defensa de cada club"
            />
          </ChartCard>
        </div>
        {backtest.length > 0 ? (
          <SortableTable
            caption={`Predicción previa de cada partido de ${team} y resultado`}
            rows={[...backtest].reverse()}
            rowKey={(p) => `${p.date ?? ''}-${p.home}-${p.away}`}
            columns={[
              { id: 'date', label: 'Fecha', value: (p) => p.date },
              {
                id: 'match',
                label: 'Partido',
                value: (p) => `${p.home} ${String(p.actualHome)}–${String(p.actualAway)} ${p.away}`,
              },
              {
                id: 'win',
                label: 'Gana',
                numeric: true,
                help: 'Probabilidad de ganar que daba el modelo antes del partido.',
                value: (p) => fromTeam(p, p.home === team).win,
                render: (p) => pct(fromTeam(p, p.home === team).win),
              },
              {
                id: 'draw',
                label: 'Empata',
                numeric: true,
                value: (p) => p.pDraw,
                render: (p) => pct(p.pDraw),
              },
              {
                id: 'loss',
                label: 'Pierde',
                numeric: true,
                value: (p) => fromTeam(p, p.home === team).loss,
                render: (p) => pct(fromTeam(p, p.home === team).loss),
              },
              { id: 'result', label: 'Resultado', value: (p) => outcome(p) },
              {
                id: 'hit',
                label: 'Lo más probable',
                help: 'Si el resultado más probable según el modelo fue el que pasó.',
                value: (p) => (mostLikely(p, team) === outcome(p) ? 1 : 0),
                render: (p) => {
                  const best = mostLikely(p, team);
                  return best === outcome(p) ? `Acertó (${best.toLowerCase()})` : `Falló (decía ${best.toLowerCase()})`;
                },
              },
            ]}
          />
        ) : null}
      </Section>

      <Section
        id="variables"
        title="Qué estadísticas usa"
        intro={`Se probaron varias combinaciones de estadísticas y quedó la que mejor predijo los partidos de este año: «${chosenSet}». Agregar más no siempre ayuda: el Elo y la racha reciente ya están contenidos en los goles y el valor del plantel, y sumarlos empeoró un poco las predicciones.`}
      >
        <SortableTable
          caption="Combinaciones de estadísticas probadas y su error en el backtest"
          rows={variables}
          rowKey={(v) => v.label}
          current={(v) => v.label === chosenSet}
          columns={[
            {
              id: 'label',
              label: 'Combinación',
              value: (v) => v.label,
              render: (v) => (v.label === chosenSet ? `${v.label} (la elegida)` : v.label),
            },
            {
              id: 'vars',
              label: 'Qué mira',
              wrap: true,
              value: (v) => v.names.length,
              render: (v) =>
                v.names.length ? v.names.map((n) => VARIABLE_TEXT[n] ?? n).join(' · ') : 'Solo goles (sin regresión)',
            },
            {
              id: 'brier',
              label: 'Brier',
              numeric: true,
              help: 'Error de las probabilidades en el backtest: más bajo es mejor.',
              value: (v) => v.brier,
              render: (v) => dec3(v.brier),
            },
            {
              id: 'll',
              label: 'Log-loss',
              numeric: true,
              help: 'Otra medida del error: más bajo es mejor.',
              value: (v) => v.log_loss,
              render: (v) => dec3(v.log_loss),
            },
          ]}
        />
        <SortableTable
          caption="Cuánto pesa cada estadística en los goles esperados"
          rows={coefs.filter((c) => c.id !== 'intercepto')}
          rowKey={(c) => c.id}
          columns={[
            { id: 'label', label: 'Estadística', value: (c) => c.label },
            {
              id: 'effect',
              label: 'Qué significa',
              wrap: true,
              value: (c) => c.coef,
              help: 'Cuánto cambian los goles esperados cuando cambia la estadística, con todo lo demás igual.',
              render: (c) => (COEF_TEXT[c.id] ?? ((b: number) => dec2(b)))(c.coef),
            },
            {
              id: 'sig',
              label: '¿Significativa?',
              value: (c) => c.p_value,
              help: 'Sí si p < 0,05: el efecto difícilmente sea casualidad. Ataque y defensa pueden no serlo por separado porque el valor del plantel ya dice mucho de lo mismo.',
              render: (c) => `${c.p_value < 0.05 ? 'Sí' : 'No'} (p ${pValue(c.p_value)})`,
            },
            {
              id: 'beta',
              label: 'β',
              numeric: true,
              help: 'Coeficiente de la regresión de Poisson (en ln de los goles esperados).',
              value: (c) => c.coef,
              render: (c) => dec3(c.coef),
            },
          ]}
        />
      </Section>

      <Section
        id="probabilidad"
        title="Probabilidad del equipo"
        intro="Pruebas de hipótesis e intervalos con los partidos de liga: si los goles se parecen a una Poisson (la base de este predictor), si la localía cambia el resultado y dónde está la media verdadera."
      >
        <ProbabilityPanel tests={tests} updated={updated} />
      </Section>
    </div>
  );
}
