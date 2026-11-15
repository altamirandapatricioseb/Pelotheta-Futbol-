'use client';

// Las seis interfaces contadas sobre una pizarra táctica. La sección queda pegada durante 600 vh: la
// cancha (vista desde arriba, vertical) va en el centro y la cámara se mueve con el scroll. Primero
// se ve el partido entero (Equipo), después se acerca a los once puntos del equipo (Jugadores),
// aísla a dos (Comparar), saca a uno con roja (Situaciones), se aleja para trazar una jugada hasta el
// arco (Gráficos) y vuelve al círculo central (Actualizar). El texto de cada interfaz aparece a un
// costado y cambia de lado en cada paso.

import { motion, type MotionValue, useMotionValueEvent, useScroll, useSpring, useTransform } from 'motion/react';
import Link from 'next/link';
import { useRef } from 'react';

import { INTERFACES, type InterfaceLink } from '@/config/navigation';

const N = 6;
/** Medio ancho de la transición alrededor de cada frontera entre pasos (en progreso 0 a 1). */
const H = 0.045;

type Six<T> = readonly [T, T, T, T, T, T];

/** Entrada y salida para useTransform: cada valor se mantiene en su paso y cambia en la frontera. */
function hold<T>(values: Six<T>): { input: number[]; output: T[] } {
  const input = [0];
  const output: T[] = [values[0]];
  values.slice(1).forEach((v, i) => {
    const k = i + 1;
    input.push(k / N - H, k / N + H);
    output.push(values[i] as T, v);
  });
  input.push(1);
  output.push(values[5]);
  return { input, output };
}

/** Lo mismo que `hold`, evaluado a mano (para la cámara, que se escribe como atributo SVG). */
function at(values: Six<number>, p: number): number {
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
  return values[5];
}

interface StepCopy {
  icon: InterfaceLink['icon'];
  lead: string;
  text: string;
}

const STEPS: Six<StepCopy> = [
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
    icon: 'situaciones',
    lead: '¿Y si se queda con uno menos?',
    text: 'Más de cien situaciones de partido: empezar perdiendo, convertir primero, jugar de visitante, según el rival o el árbitro. Cada una contra el promedio de la temporada.',
  },
  {
    icon: 'graficos',
    lead: 'Cada jugada termina en un gráfico.',
    text: 'Más de cien gráficos en 17 categorías: forma, goles, xG y remates, posesión, defensa, pelota parada, métricas propias y proyección. Todos se exportan como imagen o tabla.',
  },
  {
    icon: 'actualizar',
    lead: 'Vuelta al círculo central.',
    text: 'Un botón vuelve a correr el pipeline, trae los partidos nuevos y recalcula todo. Se ve la última actualización y el estado de cada fuente.',
  },
];

// Cámara por paso: zoom y punto de la cancha que queda en el centro (cancha de 680 × 1050).
const ZOOM: Six<number> = [1, 1.75, 1.9, 1.6, 1.05, 1];
const FOCUS_X: Six<number> = [340, 340, 340, 340, 340, 340];
const FOCUS_Y: Six<number> = [525, 770, 690, 700, 470, 525];

type Pos = readonly [number, number];
interface Player {
  n: number;
  pct: number;
  pos: Six<Pos>;
}
const same = (p: Pos, s3: Pos, s4: Pos): Six<Pos> => [p, p, p, s3, s4, p];

// El equipo propio ataca hacia arriba. Paso 3: 4-4-1 con uno menos. Paso 4: el equipo sube.
const HOME: Player[] = [
  { n: 1, pct: 0.7, pos: same([340, 985], [340, 985], [340, 900]) },
  { n: 4, pct: 0.55, pos: same([575, 830], [575, 830], [590, 600]) },
  { n: 2, pct: 0.8, pos: same([430, 870], [430, 870], [440, 660]) },
  { n: 6, pct: 0.62, pos: same([250, 870], [250, 870], [240, 660]) },
  { n: 3, pct: 0.48, pos: same([105, 830], [105, 830], [90, 600]) },
  { n: 5, pct: 0.9, pos: same([340, 730], [340, 730], [340, 520]) },
  { n: 8, pct: 0.74, pos: same([480, 680], [430, 700], [470, 400]) },
  { n: 10, pct: 0.86, pos: same([200, 680], [250, 700], [210, 420]) },
  { n: 7, pct: 0.66, pos: same([550, 520], [560, 660], [560, 230]) },
  { n: 9, pct: 0.93, pos: same([340, 480], [340, 540], [350, 170]) },
  { n: 11, pct: 0.58, pos: same([130, 520], [120, 660], [120, 260]) },
];
// Índices dentro de HOME: el expulsado del paso 3 y los dos comparados del paso 2.
const SENT_OFF = 5;
const PAIR = [6, 7];

const RIVAL: Six<Pos>[] = HOME.map(({ pos }) => {
  const [x, y] = pos[0];
  const base: Pos = [680 - x, 1050 - y];
  const deep: Pos = [680 - x, 50 + (1050 - y - 50) * 0.55];
  return same(base, base, deep);
});

// La jugada del paso 4: del arquero al arco rival, pasando por seis compañeros.
const PLAY = [0, 3, 7, 5, 6, 8, 9].map((i) => HOME[i]?.pos[4] ?? ([340, 525] as const));
const PLAY_PATH = `${PLAY.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${String(x)} ${String(y)}`).join(' ')} L340 14`;

function Dot({ player, index, progress }: { player: Player; index: number; progress: MotionValue<number> }) {
  const xs = hold(player.pos.map((p) => p[0]) as unknown as Six<number>);
  const ys = hold(player.pos.map((p) => p[1]) as unknown as Six<number>);
  const x = useTransform(progress, xs.input, xs.output);
  const y = useTransform(progress, ys.input, ys.output);
  const paired = PAIR.includes(index);
  const dim = hold<number>(index === SENT_OFF ? [1, 1, 0.25, 0.14, 1, 1] : [1, 1, paired ? 1 : 0.25, 1, 1, 1]);
  const opacity = useTransform(progress, dim.input, dim.output);
  const grow = hold<number>([1, 1, paired ? 1.45 : 1, 1, 1, 1]);
  const scale = useTransform(progress, grow.input, grow.output);
  const ring = hold<number>([0, 1, paired ? 1 : 0.2, 0.5, 0, 0]);
  const ringOpacity = useTransform(progress, ring.input, ring.output);
  const label = hold<number>([0, 1, 1, 1, 0, 0]);
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

function RivalDot({ pos, progress }: { pos: Six<Pos>; progress: MotionValue<number> }) {
  const xs = hold(pos.map((p) => p[0]) as unknown as Six<number>);
  const ys = hold(pos.map((p) => p[1]) as unknown as Six<number>);
  const x = useTransform(progress, xs.input, xs.output);
  const y = useTransform(progress, ys.input, ys.output);
  const fade = hold<number>([0.55, 0.2, 0.12, 0.3, 0.6, 0.55]);
  const opacity = useTransform(progress, fade.input, fade.output);
  return <motion.circle r={16} className="show-pitch__rival" style={{ x, y, opacity }} />;
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
  const values = [0, 0, 0, 0, 0, 0].map((_, i) => (i === step ? 1 : 0)) as unknown as Six<number>;
  const { input, output } = hold(values);
  const opacity = useTransform(progress, input, output);
  return <motion.g style={{ opacity }}>{children}</motion.g>;
}

function Panel({
  index,
  step,
  href,
  label,
  progress,
}: {
  index: number;
  step: StepCopy;
  href: string;
  label: string;
  progress: MotionValue<number>;
}) {
  const from = index / N;
  const to = (index + 1) / N;
  const first = index === 0;
  const last = index === N - 1;
  // Aparece mientras la camara termina de llegar a su paso y se va cuando empieza a irse al siguiente.
  const opacity = useTransform(
    progress,
    [first ? -1 : from, first ? -0.5 : from + H, to - H, last ? 2 : to],
    [0, 1, 1, last ? 1 : 0],
  );
  const y = useTransform(progress, [from, from + H], [first ? 0 : 32, 0]);
  return (
    <motion.article className="show-pitch__panel" data-side={index % 2 === 0 ? 'left' : 'right'} style={{ opacity, y }}>
      <p className="show-pitch__index tabular">
        {String(index + 1).padStart(2, '0')} · {label}
      </p>
      <h3 className="show-pitch__lead">{step.lead}</h3>
      <p className="show-pitch__text">{step.text}</p>
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
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const progress = useSpring(scrollYProgress, { stiffness: 110, damping: 28, mass: 0.7 });
  const playDraw = useTransform(progress, [4 / N + H, 5 / N - H], [0, 1]);

  // Cámara y pelota: se escriben como atributos SVG en cada cambio de progreso, sin re-render.
  useMotionValueEvent(progress, 'change', (p) => {
    const g = camera.current;
    if (g) {
      const s = at(ZOOM, p);
      g.setAttribute(
        'transform',
        `translate(340 525) scale(${s.toFixed(4)}) translate(${(-at(FOCUS_X, p)).toFixed(2)} ${(-at(FOCUS_Y, p)).toFixed(2)})`,
      );
    }
    const b = ball.current;
    const path = play.current;
    if (!b || !path) return;
    const t = Math.min(1, Math.max(0, (p - (4 / N + H)) / (1 / N - 2 * H)));
    const back = Math.min(1, Math.max(0, (p - (5 / N - H)) / (2 * H)));
    const pt = path.getPointAtLength(path.getTotalLength() * t);
    b.setAttribute('cx', String(pt.x + (340 - pt.x) * back));
    b.setAttribute('cy', String(pt.y + (525 - pt.y) * back));
    b.setAttribute('opacity', p > 4 / N ? '1' : '0');
  });

  const byIcon = new Map(INTERFACES.map((i) => [i.icon, i]));

  return (
    <section ref={ref} className="show-pitch show-bleed" aria-labelledby="pitch-title">
      <div className="show-pitch__stage">
        <h2 id="pitch-title" className="sr-only">
          Las seis interfaces
        </h2>
        <div className="show-pitch__panels">
          {STEPS.map((s, i) => {
            const item = byIcon.get(s.icon);
            return (
              <Panel
                key={s.icon}
                index={i}
                step={s}
                href={item?.href ?? '/'}
                label={item?.label ?? ''}
                progress={progress}
              />
            );
          })}
        </div>
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
            <Layer step={2} progress={progress}>
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
            <Layer step={4} progress={progress}>
              <motion.path ref={play} d={PLAY_PATH} className="show-pitch__play" style={{ pathLength: playDraw }} />
              <circle cx="340" cy="40" r="26" className="show-pitch__xg" />
            </Layer>
            <Layer step={5} progress={progress}>
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
              <RivalDot key={i} pos={pos} progress={progress} />
            ))}
            {HOME.map((player, i) => (
              <Dot key={player.n} player={player} index={i} progress={progress} />
            ))}
            <Layer step={3} progress={progress}>
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
            <circle ref={ball} r="9" cx="340" cy="525" className="show-pitch__ball" opacity="0" />
          </g>
        </svg>
      </div>
    </section>
  );
}
