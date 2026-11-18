'use client';

import { useState } from 'react';

import { ChartCard } from '@/components/charts/chart-card';
import { BarChart, Heatmap, ScatterChart } from '@/components/charts/primitives';
import type { ModelRun, Prediction, StatTest, Strength } from '@/lib/data/models';

import { dec2, dec3, num, pct, Section, Tiles, WaitingData } from './common';
import { ProbabilityPanel } from './probability-panel';

interface Props {
  team: string;
  run: ModelRun | null;
  predictions: Prediction[];
  strengths: Strength[];
  tests: StatTest[];
}

const SOURCE = 'Pipeline Pelotheta (resultados de la liga: Promiedos y StrikerAPI)';
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

export function PredictorView({ team, run, predictions, strengths, tests }: Props) {
  const scenarios = predictions.filter((p) => p.kind === 'escenario');
  const rivals = scenarios
    .filter((p) => p.home === team)
    .map((p) => p.away)
    .sort((a, b) => a.localeCompare(b, 'es'));
  const [rival, setRival] = useState(rivals[0] ?? '');
  const [home, setHome] = useState(true);
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

  const chosen = scenarios.find((p) =>
    home ? p.home === team && p.away === rival : p.home === rival && p.away === team,
  );
  const view = chosen ? fromTeam(chosen, home) : null;
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
        intro="Goles de cada equipo como dos Poisson independientes. λ (goles esperados) sale del ataque de uno contra la defensa del otro, medidos contra el promedio de la liga. No son cuotas: son probabilidades del modelo."
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
              {rivals.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
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
        </div>
        {view ? (
          <>
            <Tiles
              items={[
                { label: `Goles esperados de ${team}`, value: dec2(view.lambdaOwn), hint: 'λ propio' },
                { label: `Goles esperados de ${rival}`, value: dec2(view.lambdaRival), hint: 'λ rival' },
                { label: 'Gana', value: pct(view.win) },
                { label: 'Empata', value: pct(view.draw) },
                { label: 'Pierde', value: pct(view.loss) },
                { label: 'Puntos esperados', value: dec2(3 * view.win + view.draw), hint: 'E[P] = 3·P(G) + 1·P(E)' },
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
                title={`Marcadores posibles: P(${team} = i, ${rival} = j)`}
                source={SOURCE}
                updated={updated}
                coverage="Función de probabilidad conjunta: producto de las marginales por independencia"
                table={{
                  head: [`${team} \\ ${rival}`, ...goals(size)],
                  rows: view.matrix.map((row, i) => [String(i), ...row.map((c) => Number((c * 100).toFixed(1)))]),
                }}
              >
                <Heatmap
                  rows={goals(size).map((g) => `${team.split(' ')[0] ?? team} ${g}`)}
                  cols={goals(size)}
                  values={view.matrix.map((row) => row.map((c) => Number((c * 100).toFixed(1))))}
                  label={`Probabilidad en porcentaje de cada marcador entre ${team} y ${rival}`}
                />
              </ChartCard>
              <ChartCard
                id="pred-marginales"
                number="M3"
                title="Goles de cada equipo: distribuciones marginales Poisson"
                source={SOURCE}
                updated={updated}
                coverage={`E[X] = Var[X] = λ: ${dec2(view.lambdaOwn)} y ${dec2(view.lambdaRival)}`}
                table={{ head: ['Goles', team, rival], rows: ownPmf.map((p, i) => [String(i), p, rivalPmf[i] ?? 0]) }}
              >
                <BarChart
                  labels={goals(size)}
                  format={(v) => pct(v)}
                  series={[
                    { id: 'own', label: team, slot: 1, values: ownPmf },
                    { id: 'rival', label: rival, slot: 2, values: rivalPmf },
                  ]}
                  label={`Probabilidad de cada cantidad de goles de ${team} y de ${rival}`}
                />
              </ChartCard>
            </div>
          </>
        ) : null}
      </Section>

      <Section
        id="backtest"
        title="¿Acierta? Backtest sin mirar el futuro"
        intro="Cada partido de la liga se predijo solo con los partidos anteriores. Brier y log-loss: más bajo es mejor. La línea de base predice siempre la frecuencia histórica de local, empate y visitante."
      >
        <Tiles
          items={[
            { label: 'Partidos evaluados', value: String(num(m.evaluated) ?? 'n/d') },
            { label: 'Brier del modelo', value: dec3(num(m.brier)), hint: `Línea de base: ${dec3(num(m.brier_base))}` },
            {
              label: 'Log-loss del modelo',
              value: dec3(num(m.log_loss)),
              hint: `Línea de base: ${dec3(num(m.log_loss_base))}`,
            },
            {
              label: 'Goles por partido del local',
              value: dec2(num(m.mu_home)),
              hint: `Visitante: ${dec2(num(m.mu_away))}`,
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
              head: ['Club', 'Ataque', 'Defensa', 'GF', 'GC'],
              rows: [...strengths]
                .sort((a, b) => b.attack - a.attack)
                .map((s) => [s.team, s.attack, s.defense, s.goalsFor, s.goalsAgainst]),
            }}
          >
            <ScatterChart
              points={strengths.map((s) => ({
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
          <div className="data-table-wrap">
            <table className="data-table">
              <caption className="sr-only">Predicción previa de cada partido de {team} y resultado</caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Partido</th>
                  <th scope="col">Gana</th>
                  <th scope="col">Empata</th>
                  <th scope="col">Pierde</th>
                  <th scope="col">Resultado</th>
                  <th scope="col">Lo más probable</th>
                </tr>
              </thead>
              <tbody>
                {[...backtest].reverse().map((p) => {
                  const v = fromTeam(p, p.home === team);
                  const best = v.win >= v.draw && v.win >= v.loss ? 'Ganó' : v.draw >= v.loss ? 'Empató' : 'Perdió';
                  const result = outcome(p);
                  return (
                    <tr key={`${p.date ?? ''}-${p.home}-${p.away}`}>
                      <th scope="row" className="tabular">
                        {p.date}
                      </th>
                      <td>
                        {p.home} {p.actualHome}–{p.actualAway} {p.away}
                      </td>
                      <td className="tabular">{pct(v.win)}</td>
                      <td className="tabular">{pct(v.draw)}</td>
                      <td className="tabular">{pct(v.loss)}</td>
                      <td>{result}</td>
                      <td>
                        {best === result ? `Acertó (${best.toLowerCase()})` : `Falló (decía ${best.toLowerCase()})`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
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
