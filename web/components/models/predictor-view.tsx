'use client';

import { useState } from 'react';

import { ChartCard } from '@/components/charts/chart-card';
import { BarChart, Heatmap, ScatterChart } from '@/components/charts/primitives';
import type { ModelRun, Prediction, StatTest, Strength } from '@/lib/data/models';

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

export function PredictorView({ team, run, predictions, strengths, tests }: Props) {
  const scenarios = predictions.filter((p) => p.kind === 'escenario');
  // Un rival es un club en una competición: en copa puede tocar uno de otra liga o de la segunda.
  const rivalKey = (p: Prediction) => `${p.competition}|${p.home === team ? p.away : p.home}`;
  const rivals = [...new Set(scenarios.map(rivalKey))].sort((a, b) => a.localeCompare(b, 'es'));
  const [rival, setRival] = useState(rivals.find((r) => r.startsWith('liga|')) ?? rivals[0] ?? '');
  const [home, setHome] = useState(true);
  const [competition = 'liga', rivalName = ''] = rival.split('|');
  const neutral = scenarios.some((p) => rivalKey(p) === rival && p.neutral);
  const strength = strengths.find((s) => s.team === rivalName);
  const own = strengths.find((s) => s.team === team);
  const updated = run?.trainedAt ?? null;
  const m = run?.metrics ?? {};

  if (!run || run.status !== 'ok' || rivals.length === 0) {
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

  const chosen = scenarios.find(
    (p) => rivalKey(p) === rival && (neutral ? p.neutral : !p.neutral && (home ? p.home === team : p.away === team)),
  );
  const view = chosen ? fromTeam(chosen, chosen.home === team) : null;
  const variables = (Array.isArray(m.variables) ? m.variables : []) as unknown as VariableRow[];
  const coefs = (Array.isArray(m.coefs) ? m.coefs : []) as unknown as CoefRow[];
  const chosenSet = typeof m.chosen === 'string' ? m.chosen : '';
  const leagueStrengths = strengths.filter((s) => s.competition === 'liga');
  const size = view?.matrix.length ?? 0;
  const ownPmf = view ? view.matrix.map((row) => row.reduce((a, b) => a + b, 0)) : [];
  const rivalPmf = view
    ? (view.matrix[0] ?? []).map((_, j) => view.matrix.reduce((a, row) => a + (row[j] ?? 0), 0))
    : [];
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

  return (
    <div className="grid gap-10">
      <Section
        id="partido"
        title="Elegí el partido"
        intro="El modelo calcula cuántos goles espera de cada equipo con lo que hace y recibe cada uno (con más peso a lo reciente), cuánto vale cada plantel y la localía; después reparte las probabilidades de cada marcador. No son cuotas: son probabilidades del modelo."
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            Rival
            <select
              className="select"
              value={rival}
              onChange={(e) => {
                setRival(e.target.value);
              }}
            >
              {Object.keys(COMPETITIONS)
                .filter((c) => rivals.some((r) => r.startsWith(`${c}|`)))
                .map((c) => (
                  <optgroup key={c} label={compName(c)}>
                    {rivals
                      .filter((r) => r.startsWith(`${c}|`))
                      .map((r) => (
                        <option key={r} value={r}>
                          {r.split('|')[1]}
                        </option>
                      ))}
                  </optgroup>
                ))}
            </select>
          </label>
          {neutral ? (
            <span className="chip" aria-pressed="true">
              Cancha neutral ({compName(competition)})
            </span>
          ) : (
            <div role="group" aria-label="Localía" className="flex gap-2">
              <button
                type="button"
                className="chip focus-ring"
                aria-pressed={home}
                onClick={() => {
                  setHome(true);
                }}
              >
                {team} de local
              </button>
              <button
                type="button"
                className="chip focus-ring"
                aria-pressed={!home}
                onClick={() => {
                  setHome(false);
                }}
              >
                {team} de visitante
              </button>
            </div>
          )}
        </div>
        {strength?.estimated ? (
          <p className="text-sm text-muted">
            {rivalName} no tiene datos en las fuentes abiertas: su valor de plantel es un supuesto (
            {competition === 'copa_argentina'
              ? 'el 40 % del plantel más barato de Primera'
              : 'el valor típico de un club de la liga'}
            ). Tomá el resultado como orientativo.
          </p>
        ) : null}
        {view ? (
          <>
            <Tiles
              items={[
                {
                  label: `Goles esperados de ${team}`,
                  value: dec2(view.lambdaOwn),
                  help: 'λ: el promedio de goles que haría si se jugara este partido muchas veces.',
                },
                {
                  label: `Goles esperados de ${rivalName}`,
                  value: dec2(view.lambdaRival),
                  help: 'λ del rival, con la misma idea.',
                },
                { label: 'Gana', value: pct(view.win) },
                { label: 'Empata', value: pct(view.draw) },
                { label: 'Pierde', value: pct(view.loss) },
                {
                  label: 'Puntos esperados',
                  value: dec2(3 * view.win + view.draw),
                  help: '3 × P(gana) + 1 × P(empata): los puntos que sacaría en promedio.',
                },
                {
                  label: 'Valor de los planteles',
                  value: `${dec2(M(own?.value ?? null))} M €`,
                  hint: `${rivalName}: ${dec2(M(strength?.value ?? null))} M €${strength?.estimated ? ' (supuesto)' : ''}`,
                  help: 'Suma de los valores de mercado de cada plantel (transfermarkt-datasets). Es la variable que más mejoró las predicciones.',
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
                coverage={
                  view.sim ? `Monte Carlo: ${view.sim.n.toLocaleString('es-AR')} partidos simulados` : undefined
                }
                table={{
                  head: ['Resultado', 'Exacta', 'Simulación'],
                  rows: [
                    ['Gana', view.win, view.sim?.win ?? null],
                    ['Empata', view.draw, view.sim?.draw ?? null],
                    ['Pierde', view.loss, view.sim?.loss ?? null],
                  ],
                }}
              >
                <BarChart
                  labels={['Gana', 'Empata', 'Pierde']}
                  format={(v) => pct(v)}
                  series={[
                    {
                      id: 'exacta',
                      label: 'Cuenta exacta',
                      slot: 1,
                      values: [view.win, view.draw, view.loss],
                    },
                    {
                      id: 'sim',
                      label: 'Frecuencia simulada',
                      slot: 2,
                      values: view.sim ? [view.sim.win, view.sim.draw, view.sim.loss] : [null, null, null],
                    },
                  ]}
                  label="Probabilidad de ganar, empatar y perder, exacta y simulada"
                />
              </ChartCard>
              <ChartCard
                id="pred-matriz"
                number="M2"
                title={`Marcadores posibles: P(${team} = i, ${rivalName} = j)`}
                source={SOURCE}
                updated={updated}
                coverage="Función de probabilidad conjunta: producto de las marginales por independencia"
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
                title="Goles de cada equipo: distribuciones marginales Poisson"
                source={SOURCE}
                updated={updated}
                coverage={`E[X] = Var[X] = λ: ${dec2(view.lambdaOwn)} y ${dec2(view.lambdaRival)}`}
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
          </>
        ) : null}
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
