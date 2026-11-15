'use client';

// Sudamérica punteada: el alcance del selector. El continente se dibuja con puntos (silueta
// muestreada en un canvas fuera de pantalla), cada punto pertenece al país más cercano, Argentina
// enciende en verde porque es el único con datos, y al pasar el puntero se ilumina cada país.
// Con el scroll los puntos vuelan desde posiciones dispersas y se imprimen de norte a sur.

import { type MotionValue } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { COUNTRIES, countryAvailable } from '@/config/teams';

// Contorno aproximado del continente (longitud, latitud), en sentido horario desde el Darién.
const OUTLINE: [number, number][] = [
  [-77.3, 8.6],
  [-75.5, 10.8],
  [-72, 12.4],
  [-69, 11.5],
  [-66, 10.6],
  [-62, 10.7],
  [-60, 8.5],
  [-57, 6],
  [-53, 5.5],
  [-50, 1.8],
  [-48, -1],
  [-44, -2.5],
  [-39.5, -3],
  [-35, -5.5],
  [-34.9, -8],
  [-37, -11],
  [-39, -14],
  [-39, -17.5],
  [-40.5, -21],
  [-42, -23],
  [-45, -23.8],
  [-48.5, -26],
  [-48.7, -28.5],
  [-51, -31],
  [-53.5, -33.7],
  [-56, -34.9],
  [-58.4, -34.6],
  [-57.5, -37.5],
  [-62, -39],
  [-62.5, -41],
  [-65, -42.5],
  [-64.5, -45],
  [-67.5, -46.5],
  [-68, -50],
  [-68.5, -52.3],
  [-68, -54.8],
  [-72, -53.5],
  [-74, -52],
  [-75.5, -48],
  [-74.5, -44],
  [-73.5, -40],
  [-72, -35],
  [-71.5, -30],
  [-70.5, -25],
  [-70.3, -20],
  [-75, -15.5],
  [-77.5, -12],
  [-80, -8],
  [-81.2, -5],
  [-80, -2.5],
  [-80.5, 0.5],
  [-78.9, 1.5],
  [-77.5, 4],
];

// Centros de cada país (varios en los grandes): cada punto del mapa es del centro más cercano.
const SEEDS: { slug: string; pts: [number, number][] }[] = [
  {
    slug: 'argentina',
    pts: [
      [-64, -34],
      [-66, -28],
      [-68, -40],
      [-69, -47],
      [-62, -38],
      [-59, -32],
      [-65, -24],
      [-68, -52],
    ],
  },
  {
    slug: 'bolivia',
    pts: [
      [-64.5, -17],
      [-67, -16],
    ],
  },
  {
    slug: 'brasil',
    pts: [
      [-52, -10],
      [-45, -6],
      [-55, -5],
      [-48, -16],
      [-50, -22],
      [-40, -9],
      [-60, -4],
      [-66, -5],
      [-56, -14],
      [-46, -20],
      [-52, -27],
      [-43, -13],
    ],
  },
  {
    slug: 'chile',
    pts: [
      [-70.5, -23],
      [-71, -33],
      [-72.5, -42],
      [-73, -50],
      [-70, -19],
      [-72, -38],
    ],
  },
  {
    slug: 'colombia',
    pts: [
      [-73, 4],
      [-75, 8],
      [-71, 2],
    ],
  },
  { slug: 'ecuador', pts: [[-78.5, -1.5]] },
  {
    slug: 'paraguay',
    pts: [
      [-58, -23],
      [-60, -22],
    ],
  },
  {
    slug: 'peru',
    pts: [
      [-75, -10],
      [-77, -6],
      [-71, -14],
    ],
  },
  { slug: 'uruguay', pts: [[-56, -33]] },
  {
    slug: 'venezuela',
    pts: [
      [-66, 8],
      [-63, 7],
      [-70, 8],
    ],
  },
  {
    slug: 'guayanas',
    pts: [
      [-58, 5],
      [-56, 4],
      [-53, 4],
    ],
  },
];

const LON = { min: -82, max: -34 };
const LAT = { min: 12.5, max: -56 };

interface Dot {
  x: number;
  y: number;
  sx: number;
  sy: number;
  lat: number;
  country: string;
}

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

function buildDots(w: number, h: number, step: number): Dot[] {
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d');
  if (!ctx) return [];
  const px = (lon: number) => ((lon - LON.min) / (LON.max - LON.min)) * w;
  const py = (lat: number) => ((lat - LAT.min) / (LAT.max - LAT.min)) * h;
  ctx.beginPath();
  OUTLINE.forEach(([lon, lat], i) => {
    if (i === 0) ctx.moveTo(px(lon), py(lat));
    else ctx.lineTo(px(lon), py(lat));
  });
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  const { data } = ctx.getImageData(0, 0, w, h);
  const seeds = SEEDS.flatMap((s) => s.pts.map(([lon, lat]) => ({ slug: s.slug, x: px(lon), y: py(lat) })));
  const dots: Dot[] = [];
  let seed = 11;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      if ((data[(Math.floor(y) * w + Math.floor(x)) * 4 + 3] ?? 0) < 128) continue;
      let best = seeds[0];
      let bd = Infinity;
      for (const s of seeds) {
        const d = (s.x - x) ** 2 + (s.y - y) ** 2;
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      if (best) dots.push({ x, y, sx: rnd() * w, sy: rnd() * h, lat: y / h, country: best.slug });
    }
  }
  return dots;
}

interface SouthAmericaProps {
  progress: MotionValue<number>;
  className?: string;
  onHover?: (slug: string | null) => void;
  hovered: string | null;
}

export function SouthAmerica({ progress, className, onHover, hovered }: SouthAmericaProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    hoverRef.current = hovered;
  }, [hovered]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let dots: Dot[] = [];
    let width = 0;
    let height = 0;
    let raf = 0;
    let visible = true;
    let colors = { on: '#64cc4f', ink: '#f4f5f4', neon: '#8bd450' };
    const available = new Set(COUNTRIES.filter(countryAvailable).map((c) => c.slug));
    const conmebol = new Set(COUNTRIES.map((c) => c.slug));

    const readColors = () => {
      const s = getComputedStyle(document.documentElement);
      colors = {
        on: s.getPropertyValue('--color-brand').trim() || colors.on,
        ink: s.getPropertyValue('--color-text').trim() || colors.ink,
        neon: s.getPropertyValue('--color-neon').trim() || colors.neon,
      };
    };
    const layout = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // El continente es más alto que ancho (≈ 1 : 1,45): se encaja en el canvas con margen.
      const mapH = Math.min(height * 0.96, width * 1.45);
      const mapW = mapH / 1.45;
      const step = Math.max(5, Math.round(mapW / 46));
      dots = buildDots(Math.round(mapW), Math.round(mapH), step).map((d) => ({
        ...d,
        x: d.x + (width - mapW) / 2,
        y: d.y + (height - mapH) / 2,
        sx: d.sx + (width - mapW) / 2 + (d.sx - mapW / 2) * 0.8,
        sy: d.sy + (height - mapH) / 2 + (d.sy - mapH / 2) * 0.6,
      }));
      setReady(true);
    };
    const draw = () => {
      const p = progress.get();
      const t = performance.now() / 1000;
      ctx.clearRect(0, 0, width, height);
      const hover = hoverRef.current;
      for (const d of dots) {
        const k = smooth((p - d.lat * 0.25) / 0.55);
        const x = d.sx + (d.x - d.sx) * k;
        const y = d.sy + (d.y - d.sy) * k;
        const lit = d.country === hover;
        const on = available.has(d.country);
        let r = 1.6;
        if (on) {
          ctx.fillStyle = colors.neon;
          ctx.globalAlpha = 0.85 + Math.sin(t * 2 + d.y * 0.02) * 0.15;
          r = 2.4;
        } else if (lit) {
          ctx.fillStyle = colors.on;
          ctx.globalAlpha = 0.95;
          r = 2.2;
        } else {
          ctx.fillStyle = colors.ink;
          ctx.globalAlpha = conmebol.has(d.country) ? 0.38 * k + 0.08 : 0.12;
        }
        ctx.beginPath();
        ctx.arc(x, y, r * (0.6 + 0.4 * k), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (raf || !visible) return;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    readColors();
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e?.isIntersecting ?? false;
      if (visible) start();
      else stop();
    });
    io.observe(canvas);
    const theme = new MutationObserver(readColors);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let best: Dot | null = null;
      let bd = 22 * 22;
      for (const d of dots) {
        const dd = (d.x - mx) ** 2 + (d.y - my) ** 2;
        if (dd < bd) {
          bd = dd;
          best = d;
        }
      }
      onHover?.(best && conmebol.has(best.country) ? best.country : null);
    };
    const onLeave = () => onHover?.(null);
    canvas.addEventListener('pointermove', onMove, { passive: true });
    canvas.addEventListener('pointerleave', onLeave);
    start();
    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      theme.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [progress, onHover]);

  return (
    <canvas ref={ref} className={className} data-ready={ready || undefined} aria-hidden="true">
      Mapa punteado de Sudamérica con los diez países de la Conmebol.
    </canvas>
  );
}
