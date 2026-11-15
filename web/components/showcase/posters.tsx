'use client';

// Un gráfico generado por interfaz, en SVG y con movimiento propio: nada de capturas. Cada póster
// cuenta qué hace la interfaz con el tipo de visual que la caracteriza (línea, tabla, radar,
// barras apiladas, barras divergentes, anillo de progreso). Entran al aparecer en pantalla y
// después respiran en bucle con keyframes de CSS.

import { motion, stagger, type Variants } from 'motion/react';

import type { InterfaceLink } from '@/config/navigation';

const EASE = [0.16, 1, 0.3, 1] as const;
const VIEW = { once: true, margin: '-10% 0px' } as const;

const GROUP: Variants = { hidden: {}, show: { transition: { delayChildren: stagger(0.05) } } };
const GROW_X: Variants = { hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { duration: 0.9, ease: EASE } } };
const GROW_Y: Variants = { hidden: { scaleY: 0 }, show: { scaleY: 1, transition: { duration: 0.9, ease: EASE } } };
const POP: Variants = {
  hidden: { scale: 0, opacity: 0 },
  show: { scale: 1, opacity: 1, transition: { type: 'spring', stiffness: 260, damping: 18 } },
};
const DRAW: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  show: { pathLength: 1, opacity: 1, transition: { duration: 1.6, ease: 'easeInOut' } },
};

// Series deterministas (no son datos de ningún equipo): formas que se leen como fútbol.
const LINE_A = [38, 52, 47, 61, 58, 72, 69, 83, 80, 95, 91, 108, 104, 121];
const LINE_B = [38, 44, 50, 55, 61, 66, 72, 77, 83, 88, 94, 99, 105, 110];
const BARS = [3, 1, 0, 3, 3, 1, 3, 0, 3, 3, 1, 3, 3, 0];
const TABLE = [
  [4, 3, 5, 2, 4],
  [3, 5, 2, 4, 3],
  [5, 2, 4, 3, 5],
  [2, 4, 3, 5, 2],
];
const RADAR = [0.82, 0.64, 0.9, 0.55, 0.73, 0.68];
const RADAR_2 = [0.6, 0.8, 0.5, 0.75, 0.55, 0.85];
const SITU = [
  [58, 22, 20],
  [41, 30, 29],
  [67, 18, 15],
  [33, 27, 40],
  [52, 25, 23],
];
const DIVERGING = [0.62, -0.35, 0.18, -0.72, 0.44, -0.12, 0.8];

const toPath = (xs: number[], w: number, h: number, max: number) =>
  xs.map((v, i) => `${i === 0 ? 'M' : 'L'}${String((i / (xs.length - 1)) * w)} ${String(h - (v / max) * h)}`).join(' ');

function Graficos() {
  return (
    <motion.svg
      viewBox="0 0 400 250"
      className="show-poster"
      variants={GROUP}
      initial="hidden"
      whileInView="show"
      viewport={VIEW}
    >
      {[0, 1, 2, 3].map((i) => (
        <line key={i} x1={24} x2={376} y1={40 + i * 50} y2={40 + i * 50} className="show-poster__grid" />
      ))}
      {BARS.map((b, i) => (
        <motion.rect
          key={i}
          x={30 + i * 25}
          y={190 - b * 14}
          width={12}
          height={b * 14 + 1}
          className="show-poster__bar"
          variants={GROW_Y}
          style={{ transformOrigin: `${String(36 + i * 25)}px 191px` }}
        />
      ))}
      <g transform="translate(24 40)">
        <motion.path
          d={toPath(LINE_B, 352, 150, 130)}
          className="show-poster__line show-poster__line--muted"
          variants={DRAW}
        />
        <motion.path d={toPath(LINE_A, 352, 150, 130)} className="show-poster__line" variants={DRAW} />
        <motion.circle
          cx={352}
          cy={150 - (121 / 130) * 150}
          r={6}
          className="show-poster__dot show-poster__pulse"
          variants={POP}
        />
      </g>
    </motion.svg>
  );
}

function Equipo() {
  return (
    <motion.svg
      viewBox="0 0 400 250"
      className="show-poster"
      variants={GROUP}
      initial="hidden"
      whileInView="show"
      viewport={VIEW}
    >
      {TABLE.map((row, r) => (
        <g key={r}>
          <motion.rect
            x={24}
            y={34 + r * 50}
            width={60}
            height={34}
            rx={6}
            className="show-poster__cell show-poster__cell--head"
            variants={GROW_X}
            style={{ transformOrigin: '24px 0px' }}
          />
          {row.map((v, c) => (
            <motion.rect
              key={c}
              x={96 + c * 58}
              y={34 + r * 50}
              width={48}
              height={34}
              rx={6}
              className="show-poster__cell"
              style={{
                opacity: 0.25 + v * 0.15,
                transformOrigin: `${String(120 + c * 58)}px ${String(51 + r * 50)}px`,
              }}
              variants={POP}
            />
          ))}
        </g>
      ))}
      <motion.rect
        x={24}
        y={232}
        width={352}
        height={4}
        rx={2}
        className="show-poster__bar show-poster__scan"
        variants={GROW_X}
        style={{ transformOrigin: '24px 0px' }}
      />
    </motion.svg>
  );
}

const radarPoints = (vals: number[], r: number) =>
  vals
    .map((v, i) => {
      const a = (i / vals.length) * Math.PI * 2 - Math.PI / 2;
      return `${String(200 + Math.cos(a) * r * v)},${String(125 + Math.sin(a) * r * v)}`;
    })
    .join(' ');

function Jugadores() {
  return (
    <motion.svg
      viewBox="0 0 400 250"
      className="show-poster"
      variants={GROUP}
      initial="hidden"
      whileInView="show"
      viewport={VIEW}
    >
      {[0.33, 0.66, 1].map((k) => (
        <polygon key={k} points={radarPoints([1, 1, 1, 1, 1, 1], 100 * k)} className="show-poster__grid-shape" />
      ))}
      <motion.polygon
        points={radarPoints(RADAR_2, 100)}
        className="show-poster__shape show-poster__shape--muted"
        variants={POP}
        style={{ transformOrigin: '200px 125px' }}
      />
      <motion.polygon
        points={radarPoints(RADAR, 100)}
        className="show-poster__shape show-poster__breathe"
        variants={POP}
        style={{ transformOrigin: '200px 125px' }}
      />
      {RADAR.map((v, i) => {
        const a = (i / RADAR.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <motion.circle
            key={i}
            cx={200 + Math.cos(a) * 100 * v}
            cy={125 + Math.sin(a) * 100 * v}
            r={5}
            className="show-poster__dot"
            variants={POP}
          />
        );
      })}
    </motion.svg>
  );
}

function Situaciones() {
  return (
    <motion.svg
      viewBox="0 0 400 250"
      className="show-poster"
      variants={GROUP}
      initial="hidden"
      whileInView="show"
      viewport={VIEW}
    >
      {SITU.map((row, r) => {
        let x = 24;
        return (
          <g key={r}>
            {row.map((v, k) => {
              const w = (v / 100) * 352;
              const rect = (
                <motion.rect
                  key={k}
                  x={x}
                  y={30 + r * 42}
                  width={w - 3}
                  height={26}
                  rx={5}
                  className={`show-poster__seg show-poster__seg--${String(k)}`}
                  variants={GROW_X}
                  style={{ transformOrigin: `${String(x)}px 0px` }}
                />
              );
              x += w;
              return rect;
            })}
          </g>
        );
      })}
    </motion.svg>
  );
}

function Comparar() {
  return (
    <motion.svg
      viewBox="0 0 400 250"
      className="show-poster"
      variants={GROUP}
      initial="hidden"
      whileInView="show"
      viewport={VIEW}
    >
      <line x1={200} x2={200} y1={16} y2={234} className="show-poster__axis" />
      {DIVERGING.map((v, i) => {
        const w = Math.abs(v) * 170;
        const x = v > 0 ? 200 : 200 - w;
        return (
          <motion.rect
            key={i}
            x={x}
            y={24 + i * 30}
            width={w}
            height={20}
            rx={4}
            className={v > 0 ? 'show-poster__bar' : 'show-poster__bar show-poster__bar--alt'}
            variants={GROW_X}
            style={{ transformOrigin: '200px 0px' }}
          />
        );
      })}
    </motion.svg>
  );
}

function Actualizar() {
  const r = 78;
  const c = 2 * Math.PI * r;
  return (
    <motion.svg
      viewBox="0 0 400 250"
      className="show-poster"
      variants={GROUP}
      initial="hidden"
      whileInView="show"
      viewport={VIEW}
    >
      <circle cx={140} cy={125} r={r} className="show-poster__ring-rail" />
      <motion.circle
        cx={140}
        cy={125}
        r={r}
        className="show-poster__ring show-poster__spin"
        strokeDasharray={c}
        variants={DRAW}
        style={{ rotate: -90, transformOrigin: '140px 125px' }}
      />
      {['Promiedos', 'StrikerAPI', 'ScoutingStats', 'Statshub'].map((s, i) => (
        <g key={s}>
          <motion.circle
            cx={262}
            cy={56 + i * 46}
            r={9}
            className="show-poster__dot"
            variants={POP}
            style={{ transformOrigin: `262px ${String(56 + i * 46)}px` }}
          />
          <motion.rect
            x={284}
            y={50 + i * 46}
            width={92 - i * 12}
            height={12}
            rx={6}
            className="show-poster__cell"
            variants={GROW_X}
            style={{ transformOrigin: '284px 0px' }}
          />
        </g>
      ))}
    </motion.svg>
  );
}

const POSTERS: Record<InterfaceLink['icon'], () => React.JSX.Element> = {
  graficos: Graficos,
  equipo: Equipo,
  jugadores: Jugadores,
  situaciones: Situaciones,
  comparar: Comparar,
  actualizar: Actualizar,
};

export function Poster({ icon }: { icon: InterfaceLink['icon'] }) {
  const Component = POSTERS[icon];
  return <Component />;
}
