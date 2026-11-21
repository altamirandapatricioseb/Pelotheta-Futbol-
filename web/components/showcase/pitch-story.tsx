'use client';

// Las diez interfaces contadas sobre una pizarra táctica. La sección queda pegada (100 vh por paso
// en escritorio, 80 en el celular): la cancha (vista desde arriba, vertical) va en el centro y la
// cámara se mueve con el scroll. Partido entero (Equipo), los once puntos (Jugadores), dos aislados
// (Comparar), uno y sus parecidos de otros clubes (Alternativas), la línea del valor (Valor), una
// roja (Situaciones), la barra de probabilidades (Predictor), una jugada hasta el arco (Gráficos), el mercado (Ojeador) y
// vuelta al círculo central (Actualizar). El texto cambia de lado en cada paso; en el celular va
// debajo de la cancha.

import { motion, type MotionValue, useMotionValueEvent, useScroll, useSpring, useTransform } from 'motion/react';
import Link from 'next/link';
import { useRef } from 'react';

import { INTERFACES, type InterfaceLink } from '@/config/navigation';

import { useWide } from './use-wide';

interface StepCopy {
  icon: InterfaceLink['icon'];
  lead: string;
  text: string;
}

const STEPS: readonly StepCopy[] = [
  {
    icon: 'equipo',
    lead: 'El partido entero, de arriba.',
    text: 'Tablas por partido, por rival, por mes y por competición: goles, remates, xG, posesión, defensa y pelota parada. Cada tabla se descarga a Excel.',
  },
  {
    icon: 'jugadores',
    lead: 'Cada punto es un jugador.',
    text: 'El plantel completo con sus estadísticas y sus percentiles contra el resto del plantel, por posición. Cada jugador tiene su ficha, partido a partido.',
  },
  {
    icon: 'comparar',
    lead: 'Dos jugadores, frente a frente.',
    text: 'Estadística por estadística, en totales o cada 90 minutos, con la media del equipo y la de su posición como referencia.',
  },
  {
    icon: 'alternativas',
    lead: 'Si se va, ¿quién se le parece?',
    text: 'Para cada jugador, las opciones más parecidas: uno de otro club, una dupla o un compañero, de la mejor a la peor. K-means sobre 17 estadísticas cada 90 minutos.',
  },
  {
    icon: 'valor',
    lead: '¿Cuánto vale de verdad?',
    text: 'El valor de mercado de cada jugador contra el que predice una regresión lineal con su edad, sus minutos y su rendimiento. Arriba de la línea el mercado lo paga más; abajo, sale barato.',
  },
  {
    icon: 'situaciones',
    lead: '¿Y si se queda con uno menos?',
    text: 'Más de cien situaciones de partido: empezar perdiendo, convertir primero, jugar de visitante, según el rival o el árbitro. Cada una contra el promedio de la temporada.',
  },
  {
    icon: 'predictor',
    lead: 'El próximo partido, en porcentajes.',
    text: 'Probabilidad de ganar, empatar y perder contra cada rival con un modelo de Poisson entrenado con tres temporadas de la liga, el marcador más probable y un backtest de cuánto acierta.',
  },
  {
    icon: 'graficos',
    lead: 'Cada jugada termina en un gráfico.',
    text: 'Más de cien gráficos en 17 categorías: forma, goles, xG y remates, posesión, defensa, pelota parada, métricas propias y proyección. Todos se exportan como imagen o tabla.',
  },
  {
    icon: 'ojeador',
    lead: '¿A quién vamos a buscar?',
    text: 'Informes como los de un ojeador, con nota de 0 a 10: qué puesto le falta al plantel (profundidad, nivel, edad y contratos), oportunidades baratas para su puesto y edad, y jóvenes promesas de otros clubes con su potencial.',
  },
  {
    icon: 'actualizar',
    lead: 'Vuelta al círculo central.',
    text: 'Un botón vuelve a correr el pipeline: trae los partidos nuevos, recalcula las métricas y vuelve a entrenar los tres modelos. Se ve la última actualización y el estado de cada fuente.',
  },
];

const N = STEPS.length;
/** Medio ancho de la transición alrededor de cada frontera entre pasos (en progreso 0 a 1). */
const H = 0.028;
const stepOf = (icon: InterfaceLink['icon']) => STEPS.findIndex((s) => s.icon === icon);
const ALT = stepOf('alternativas');
const RED = stepOf('situaciones');
const PRED = stepOf('predictor');
const GRAF = stepOf('graficos');
const SCOUT = stepOf('ojeador');

/** Un valor por paso: el de base, salvo en los pasos que se nombran. */
function per<T>(base: T, overrides: Partial<Record<InterfaceLink['icon'], T>>): T[] {
  return STEPS.map((s) => overrides[s.icon] ?? base);
}

/** Entrada y salida para useTransform: cada valor se mantiene en su paso y cambia en la frontera. */
function hold<T>(values: readonly T[]): { input: number[]; output: T[] } {
  const input = [0];
  const output: T[] = [values[0] as T];
  values.slice(1).forEach((v, i) => {
    const k = i + 1;
    input.push(k / N - H, k / N + H);
    output.push(values[i] as T, v);
  });
  input.push(1);
  output.push(values[N - 1] as T);
  return { input, output };
}

/** Lo mismo que `hold`, evaluado a mano (para la cámara, que se escribe como atributo SVG). */
function at(values: readonly number[], p: number): number {
  const { input, output } = hold(values);
  for (let i = 1; i < input.length; i++) {
    const a = input[i - 1] ?? 0;
    const b = input[i] ?? 1;
    if (p <= b) {
      const t = b === a ? 1 : Math.min(1, Math.max(0, (p - a) / (b - a)));
      const e = t * t * (3 - 2 * t);
      const from = output[i - 1] ?? 0;
      return from + ((output[i] ?? from) - from) * e;
    }
  }
  return values[N - 1] ?? 0;
}

// Cámara por paso: zoom y punto de la cancha que queda en el centro (cancha de 680 × 1050).
const ZOOM = per(1, {
  jugadores: 1.75,
  comparar: 1.9,
  alternativas: 1.35,
  situaciones: 1.6,
  predictor: 1.15,
  graficos: 1.05,
  ojeador: 1.3,
});
const FOCUS_Y = per(525, { jugadores: 770, comparar: 690, alternativas: 560, situaciones: 700, graficos: 470, ojeador: 390 });

type Pos = readonly [number, number];
interface Player {
  n: number;
  pct: number;
  pos: Pos[];
}
// Tres formas del equipo: la base, con uno menos (Situaciones) y adelantado (Gráficos).
const shape = (p: Pos, red: Pos, attack: Pos): Pos[] =>
  STEPS.map((_, i) => (i === RED ? red : i === GRAF ? attack : p));

// El equipo propio ataca hacia arriba.
const HOME: Player[] = [
  { n: 1, pct: 0.7, pos: shape([340, 985], [340, 985], [340, 900]) },
  { n: 4, pct: 0.55, pos: shape([575, 830], [575, 830], [590, 600]) },
  { n: 2, pct: 0.8, pos: shape([430, 870], [430, 870], [440, 660]) },
  { n: 6, pct: 0.62, pos: shape([250, 870], [250, 870], [240, 660]) },
  { n: 3, pct: 0.48, pos: shape([105, 830], [105, 830], [90, 600]) },
  { n: 5, pct: 0.9, pos: shape([340, 730], [340, 730], [340, 520]) },
  { n: 8, pct: 0.74, pos: shape([480, 680], [430, 700], [470, 400]) },
  { n: 10, pct: 0.86, pos: shape([200, 680], [250, 700], [210, 420]) },
  { n: 7, pct: 0.66, pos: shape([550, 520], [560, 660], [560, 230]) },
  { n: 9, pct: 0.93, pos: shape([340, 480], [340, 540], [350, 170]) },
  { n: 11, pct: 0.58, pos: shape([130, 520], [120, 660], [120, 260]) },
];
// Índices dentro de HOME: el expulsado y los dos comparados (el primero es el de Alternativas).
const SENT_OFF = 5;
const PAIR = [6, 7];
// Índices dentro de RIVAL: las tres opciones de otro club en Alternativas.
const OPTIONS = [6, 7, 8];
// Índices dentro de RIVAL que mira el Ojeador, con la nota de su informe (ilustrativa) y su color.
const SCOUTED = [
  { i: 9, score: '8,1', tone: 'show-pitch__grade--good' },
  { i: 5, score: '6,4', tone: 'show-pitch__grade--mid' },
  { i: 3, score: '4,2', tone: 'show-pitch__grade--bad' },
];

const RIVAL: Pos[][] = HOME.map(({ pos }) => {
  const [x, y] = pos[0] ?? [340, 525];
  const base: Pos = [680 - x, 1050 - y];
  const deep: Pos = [680 - x, 50 + (1050 - y - 50) * 0.55];
  return shape(base, base, deep);
});

// La jugada de Gráficos: del arquero al arco rival, pasando por seis compañeros.
const PLAY = [0, 3, 7, 5, 6, 8, 9].map((i) => HOME[i]?.pos[GRAF] ?? ([340, 525] as const));
const PLAY_PATH = `${PLAY.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${String(x)} ${String(y)}`).join(' ')} L340 14`;
const TARGET = HOME[PAIR[0] ?? 0]?.pos[ALT] ?? ([340, 525] as const);

// Barra del paso Predictor: un ejemplo ilustrativo (gana, empata, pierde), no un partido real.
const ODDS = [
  { key: 'gana', share: 0.48, className: 'show-pitch__bar' },
  { key: 'empata', share: 0.27, className: 'show-pitch__bar show-pitch__bar--mid' },
  { key: 'pierde', share: 0.25, className: 'show-pitch__bar show-pitch__bar--alt' },
].map((o, i, all) => ({ ...o, x: 120 + 440 * all.slice(0, i).reduce((s, p) => s + p.share, 0), w: 440 * o.share }));

function Dot({ player, index, progress }: { player: Player; index: number; progress: MotionValue<number> }) {
  const xs = hold(player.pos.map((p) => p[0]));
  const ys = hold(player.pos.map((p) => p[1]));
  const x = useTransform(progress, xs.input, xs.output);
  const y = useTransform(progress, ys.input, ys.output);
  const paired = PAIR.includes(index);
  const target = index === PAIR[0];
  const dim = hold(
    per(1, {
      comparar: paired ? 1 : 0.25,
      alternativas: target ? 1 : 0.25,
      situaciones: index === SENT_OFF ? 0.14 : 1,
      ojeador: 0.2,
    }),
  );
  const opacity = useTransform(progress, dim.input, dim.output);
  const grow = hold(per(1, { comparar: paired ? 1.45 : 1, alternativas: target ? 1.45 : 1 }));
  const scale = useTransform(progress, grow.input, grow.output);
  const ring = hold(
    per(0, { jugadores: 1, comparar: paired ? 1 : 0.2, alternativas: target ? 1 : 0.2, valor: 1, situaciones: 0.5 }),
  );
  const ringOpacity = useTransform(progress, ring.input, ring.output);
  const label = hold(per(0, { jugadores: 1, comparar: 1, alternativas: 1, valor: 1, situaciones: 1 }));
  const labelOpacity = useTransform(progress, label.input, label.output);
  const c = 2 * Math.PI * 30;
  return (
    <motion.g style={{ x, y, opacity, scale }}>
      <motion.circle
        r={30}
        className="show-pitch__ring"
        strokeDasharray={`${String(c * player.pct)} ${String(c)}`}
        transform="rotate(-90)"
        style={{ opacity: ringOpacity }}
      />
      <circle r={19} className="show-pitch__home" />
      <motion.text className="show-pitch__num" textAnchor="middle" dy="6" style={{ opacity: labelOpacity }}>
        {player.n}
      </motion.text>
    </motion.g>
  );
}

function RivalDot({ pos, index, progress }: { pos: Pos[]; index: number; progress: MotionValue<number> }) {
  const xs = hold(pos.map((p) => p[0]));
  const ys = hold(pos.map((p) => p[1]));
  const x = useTransform(progress, xs.input, xs.output);
  const y = useTransform(progress, ys.input, ys.output);
  const option = OPTIONS.includes(index);
  const scouted = SCOUTED.some((s) => s.i === index);
  const fade = hold(
    per(0.55, {
      ojeador: scouted ? 1 : 0.15,
      jugadores: 0.2,
      comparar: 0.12,
      alternativas: option ? 0.95 : 0.12,
      valor: 0.2,
      situaciones: 0.3,
      graficos: 0.6,
    }),
  );
  const opacity = useTransform(progress, fade.input, fade.output);
  const grow = hold(per(1, { alternativas: option ? 1.35 : 1, ojeador: scouted ? 1.3 : 1 }));
  const scale = useTransform(progress, grow.input, grow.output);
  return <motion.circle r={16} className="show-pitch__rival" style={{ x, y, opacity, scale }} />;
}

/** Capa que solo se ve en un paso. */
function Layer({
  step,
  progress,
  children,
}: {
  step: number;
  progress: MotionValue<number>;
  children: React.ReactNode;
}) {
  const { input, output } = hold(STEPS.map((_, i) => (i === step ? 1 : 0)));
  const opacity = useTransform(progress, input, output);
  return <motion.g style={{ opacity }}>{children}</motion.g>;
}

function Panel({
  index,
  copy,
  href,
  label,
  progress,
}: {
  index: number;
  copy: StepCopy;
  href: string;
  label: string;
  progress: MotionValue<number>;
}) {
  const from = index / N;
  const to = (index + 1) / N;
  const first = index === 0;
  const last = index === N - 1;
  // Aparece mientras la cámara termina de llegar a su paso y se va cuando empieza a irse al siguiente.
  const opacity = useTransform(
    progress,
    [first ? -1 : from, first ? -0.5 : from + H, to - H, last ? 2 : to],
    [0, 1, 1, last ? 1 : 0],
  );
  const y = useTransform(progress, [from, from + H], [first ? 0 : 24, 0]);
  // Un panel apagado no recibe toques: si no, el enlace invisible de otro paso tapa al visible.
  const pointerEvents = useTransform(opacity, (o) => (o > 0.5 ? 'auto' : 'none'));
  return (
    <motion.article
      className="show-pitch__panel"
      data-side={index % 2 === 0 ? 'left' : 'right'}
      style={{ opacity, y, pointerEvents }}
    >
      <p className="show-pitch__index tabular">
        {String(index + 1).padStart(2, '0')} · {label}
      </p>
      <h3 className="show-pitch__lead">{copy.lead}</h3>
      <p className="show-pitch__text">{copy.text}</p>
      <Link href={href} className="show-pitch__go focus-ring" data-cursor="Entrar">
        Entrar a {label}
      </Link>
    </motion.article>
  );
}

export function PitchStory() {
  const ref = useRef<HTMLElement>(null);
  const camera = useRef<SVGGElement>(null);
  const ball = useRef<SVGCircleElement>(null);
  const play = useRef<SVGPathElement>(null);
  const wide = useWide();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  // Con mouse, inercia suave. Con el dedo el teléfono ya trae inercia y el resorte encima se sentía
  // trabado: ahí el progreso sigue al scroll tal cual.
  const smooth = useSpring(scrollYProgress, { stiffness: 110, damping: 28, mass: 0.7 });
  // Derivado y no el scrollYProgress mismo: motion acelera con WAAPI las transformaciones directas del
  // scroll y rechaza los rangos de entrada de los paneles (fuera de 0 a 1).
  const direct = useTransform(() => scrollYProgress.get());
  const progress = wide ? smooth : direct;
  const playDraw = useTransform(progress, [GRAF / N + H, (GRAF + 1) / N - H], [0, 1]);

  // Cámara y pelota: se escriben como atributos SVG en cada cambio de progreso, sin re-render.
  useMotionValueEvent(progress, 'change', (p) => {
    const g = camera.current;
    if (g) {
      const s = at(ZOOM, p);
      g.setAttribute(
        'transform',
        `translate(340 525) scale(${s.toFixed(4)}) translate(-340 ${(-at(FOCUS_Y, p)).toFixed(2)})`,
      );
    }
    const b = ball.current;
    const path = play.current;
    if (!b || !path) return;
    const t = Math.min(1, Math.max(0, (p - (GRAF / N + H)) / (1 / N - 2 * H)));
    const back = Math.min(1, Math.max(0, (p - ((GRAF + 1) / N - H)) / (2 * H)));
    const pt = path.getPointAtLength(path.getTotalLength() * t);
    b.setAttribute('cx', String(pt.x + (340 - pt.x) * back));
    b.setAttribute('cy', String(pt.y + (525 - pt.y) * back));
    b.setAttribute('opacity', p > GRAF / N ? '1' : '0');
  });

  const byIcon = new Map(INTERFACES.map((i) => [i.icon, i]));

  return (
    <section ref={ref} className="show-pitch show-bleed" aria-labelledby="pitch-title">
      <div className="show-pitch__stage">
        <h2 id="pitch-title" className="sr-only">
          Las {N} interfaces
        </h2>
        <svg
          viewBox="0 0 680 1050"
          className="show-pitch__board"
          role="img"
          aria-label="Pizarra táctica: la cancha con los once jugadores del equipo y los del rival"
        >
          <g ref={camera}>
            <rect x="0" y="0" width="680" height="1050" className="show-pitch__grass" />
            <Layer step={0} progress={progress}>
              <rect x="0" y="0" width="680" height="350" className="show-pitch__zone" style={{ opacity: 0.1 }} />
              <rect x="0" y="350" width="680" height="350" className="show-pitch__zone" style={{ opacity: 0.24 }} />
              <rect x="0" y="700" width="680" height="350" className="show-pitch__zone" style={{ opacity: 0.15 }} />
            </Layer>
            <g className="show-pitch__lines">
              <rect x="4" y="4" width="672" height="1042" />
              <line x1="4" x2="676" y1="525" y2="525" />
              <circle cx="340" cy="525" r="91.5" />
              <rect x="138.5" y="4" width="403" height="165" />
              <rect x="248.5" y="4" width="183" height="55" />
              <rect x="138.5" y="881" width="403" height="165" />
              <rect x="248.5" y="991" width="183" height="55" />
              <path d="M267 169 A 91.5 91.5 0 0 0 413 169" />
              <path d="M267 881 A 91.5 91.5 0 0 1 413 881" />
            </g>
            <Layer step={stepOf('comparar')} progress={progress}>
              <line x1="200" x2="480" y1="680" y2="680" className="show-pitch__link" />
              {[0.7, -0.45, 0.3, -0.8, 0.55].map((v, i) => (
                <rect
                  key={i}
                  x={v > 0 ? 340 : 340 + v * 90}
                  y={596 + i * 13}
                  width={Math.abs(v) * 90}
                  height={8}
                  rx={3}
                  className={v > 0 ? 'show-pitch__bar' : 'show-pitch__bar show-pitch__bar--alt'}
                />
              ))}
            </Layer>
            <Layer step={ALT} progress={progress}>
              {OPTIONS.map((r) => {
                const [x, y] = RIVAL[r]?.[ALT] ?? [340, 525];
                return <line key={r} x1={TARGET[0]} y1={TARGET[1]} x2={x} y2={y} className="show-pitch__link" />;
              })}
            </Layer>
            <Layer step={stepOf('valor')} progress={progress}>
              <line x1="70" y1="990" x2="610" y2="70" className="show-pitch__link" />
            </Layer>
            <Layer step={GRAF} progress={progress}>
              <motion.path ref={play} d={PLAY_PATH} className="show-pitch__play" style={{ pathLength: playDraw }} />
              <circle cx="340" cy="40" r="26" className="show-pitch__xg" />
            </Layer>
            <Layer step={SCOUT} progress={progress}>
              {SCOUTED.map(({ i, score, tone }, k) => {
                const [x, y] = RIVAL[i]?.[SCOUT] ?? [340, 525];
                return (
                  <g key={i} transform={`translate(${String(x)} ${String(y)})`}>
                    <circle
                      r="34"
                      className="show-pitch__scope"
                      style={{ animationDelay: `${String(k * -1.5)}s` }}
                    />
                    <line x1="-46" x2="-30" className="show-pitch__scope-tick" />
                    <line x1="30" x2="46" className="show-pitch__scope-tick" />
                    <line y1="-46" y2="-30" className="show-pitch__scope-tick" />
                    <line y1="30" y2="46" className="show-pitch__scope-tick" />
                    <g transform="translate(0 -66)">
                      <rect x="-34" y="-18" width="68" height="36" rx="9" className={`show-pitch__grade ${tone}`} />
                      <text textAnchor="middle" dy="7" className="show-pitch__grade-text">
                        {score}
                      </text>
                    </g>
                  </g>
                );
              })}
            </Layer>
            <Layer step={N - 1} progress={progress}>
              {[0, 1, 2].map((i) => (
                <circle
                  key={i}
                  cx="340"
                  cy="525"
                  r="60"
                  className="show-pitch__ripple"
                  style={{ animationDelay: `${String(i * 0.8)}s` }}
                />
              ))}
            </Layer>
            {RIVAL.map((pos, i) => (
              <RivalDot key={i} pos={pos} index={i} progress={progress} />
            ))}
            {HOME.map((player, i) => (
              <Dot key={player.n} player={player} index={i} progress={progress} />
            ))}
            <Layer step={RED} progress={progress}>
              <rect
                x="356"
                y="690"
                width="16"
                height="23"
                rx="2"
                className="show-pitch__card"
                transform="rotate(12 364 701)"
              />
              <g transform="translate(340 600)">
                <rect x="-62" y="-22" width="124" height="44" rx="10" className="show-pitch__score" />
                <text textAnchor="middle" dy="8" className="show-pitch__score-text">
                  0 – 1
                </text>
              </g>
            </Layer>
            <Layer step={PRED} progress={progress}>
              <rect x="100" y="470" width="480" height="110" rx="16" className="show-pitch__score" />
              {ODDS.map((o) => (
                <g key={o.key}>
                  <rect x={o.x} y="490" width={o.w - 4} height="70" rx="8" className={o.className} />
                  <text x={o.x + o.w / 2} y="534" textAnchor="middle" className="show-pitch__odds">
                    {Math.round(o.share * 100)} %
                  </text>
                </g>
              ))}
            </Layer>
            <circle ref={ball} r="9" cx="340" cy="525" className="show-pitch__ball" opacity="0" />
          </g>
        </svg>
        <div className="show-pitch__panels">
          {STEPS.map((s, i) => {
            const item = byIcon.get(s.icon);
            return (
              <Panel
                key={s.icon}
                index={i}
                copy={s}
                href={item?.href ?? '/'}
                label={item?.label ?? ''}
                progress={progress}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
