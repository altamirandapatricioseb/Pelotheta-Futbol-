'use client';

// Canvas de la portada: cada remate de Boca 2026 como una partícula en su posición real de la
// cancha (tamaño por xG, los goles en neón). Con el scroll las partículas migran y arman la Θ de
// Pelotheta: el glifo es, literalmente, el círculo central y la línea de mitad de cancha.
// Un solo requestAnimationFrame, solo mientras está en pantalla; con «reducir movimiento» se
// dibuja un cuadro fijo por cada cambio de progreso.

import { useMotionValueEvent, useReducedMotion, type MotionValue } from 'motion/react';
import { useEffect, useRef } from 'react';

import type { ShowcaseShot } from '@/lib/data/showcase';

interface ShotFieldProps {
  shots: ShowcaseShot[];
  /** 0 = mapa de remates, 1 = Θ armada. */
  progress: MotionValue<number>;
  className?: string;
}

interface Particle {
  px: number;
  py: number;
  tx: number;
  ty: number;
  r: number;
  goal: boolean;
  phase: number;
}

const DPR_MAX = 2;
const POINTER_RADIUS = 110;

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Puntos dentro del glifo Θ, muestreando los píxeles de un canvas fuera de pantalla. */
function sampleTheta(size: number, count: number, font: string): { x: number; y: number }[] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return [];
  ctx.font = `800 ${String(size * 0.98)}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText('Θ', size / 2, size / 2 + size * 0.04);
  const { data } = ctx.getImageData(0, 0, size, size);
  const step = Math.max(2, Math.floor(size / 56));
  const pts: { x: number; y: number }[] = [];
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      if ((data[(y * size + x) * 4 + 3] ?? 0) > 128) pts.push({ x: x / size, y: y / size });
    }
  }
  // Mezcla determinista para que cada remate reciba un punto repartido por todo el glifo.
  let seed = 7;
  for (let i = pts.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    const a = pts[i];
    const b = pts[j];
    if (a && b) {
      pts[i] = b;
      pts[j] = a;
    }
  }
  return Array.from({ length: count }, (_, i) => pts[i % Math.max(1, pts.length)] ?? { x: 0.5, y: 0.5 });
}

export function ShotField({ shots, progress, className }: ShotFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const drawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let pitch = { left: 0, top: 0, w: 0, h: 0 };
    let colors = { neon: '#8bd450', ink: '#f4f5f4', line: '#3d3f3d' };
    const pointer = { x: -9999, y: -9999 };
    let frame = 0;
    let raf = 0;
    let visible = true;

    const readColors = () => {
      const s = getComputedStyle(document.documentElement);
      colors = {
        neon: s.getPropertyValue('--color-neon').trim() || colors.neon,
        ink: s.getPropertyValue('--color-text').trim() || colors.ink,
        line: s.getPropertyValue('--color-border').trim() || colors.line,
      };
    };

    const layout = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Media cancha vertical (arco arriba). En escritorio ocupa la mitad derecha; en el celular, la
      // franja superior, por encima del título.
      const wide = width >= 860;
      const areaW = wide ? width * 0.5 : width;
      const areaH = wide ? height : height * 0.56;
      const areaLeft = wide ? width * 0.5 : 0;
      const size = Math.min(areaW * 0.72, areaH * 0.78);
      pitch = {
        w: size,
        h: size * (52.5 / 68),
        left: areaLeft + (areaW - size) / 2,
        top: (areaH - size * (52.5 / 68)) / 2 + (wide ? 0 : height * 0.02),
      };
      const glyph = Math.min(areaW * 0.86, areaH * 0.86);
      const gLeft = areaLeft + (areaW - glyph) / 2;
      const gTop = (areaH - glyph) / 2;
      const font = getComputedStyle(document.body).fontFamily;
      const targets = sampleTheta(Math.round(Math.min(360, glyph)), shots.length, font);
      particles = shots.map((s, i) => {
        const t = targets[i] ?? { x: 0.5, y: 0.5 };
        return {
          px: pitch.left + s.y * pitch.w,
          py: pitch.top + s.x * pitch.h,
          tx: gLeft + t.x * glyph,
          ty: gTop + t.y * glyph,
          r: Math.min(9, 1.8 + s.xg * 14),
          goal: s.goal,
          phase: (i * 0.618) % (Math.PI * 2),
        };
      });
    };

    const draw = () => {
      const p = smooth((progress.get() - 0.08) / 0.78);
      const t = reduced ? 0 : performance.now() / 1000;
      ctx.clearRect(0, 0, width, height);

      // Líneas de la cancha, que se apagan a medida que las partículas se van.
      if (p < 1) {
        const { left, top, w, h } = pitch;
        const m = w / 68;
        ctx.save();
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = colors.line;
        ctx.lineWidth = 1;
        ctx.strokeRect(left, top, w, h);
        ctx.strokeRect(left + (w - 40.3 * m) / 2, top, 40.3 * m, 16.5 * m);
        ctx.strokeRect(left + (w - 18.3 * m) / 2, top, 18.3 * m, 5.5 * m);
        ctx.beginPath();
        ctx.arc(left + w / 2, top + 11 * m, 9.15 * m, 0.3, Math.PI - 0.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(left + w / 2, top + h, 9.15 * m, Math.PI, 0);
        ctx.stroke();
        ctx.restore();
      }

      for (const q of particles) {
        let x = q.px + (q.tx - q.px) * p;
        let y = q.py + (q.ty - q.py) * p;
        if (!reduced) {
          x += Math.sin(t * 0.9 + q.phase) * 1.6;
          y += Math.cos(t * 0.7 + q.phase) * 1.6;
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < POINTER_RADIUS * POINTER_RADIUS && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const push = (1 - d / POINTER_RADIUS) * 26;
            x += (dx / d) * push;
            y += (dy / d) * push;
          }
        }
        const r = q.r * (1 - p * 0.45) + p * 2.2;
        if (q.goal) {
          ctx.fillStyle = colors.neon;
          ctx.globalAlpha = 0.22;
          ctx.beginPath();
          ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = colors.ink;
          ctx.globalAlpha = 0.32 + p * 0.5;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };
    drawRef.current = draw;

    const loop = () => {
      if (frame++ % 30 === 0) readColors();
      draw();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (reduced || raf || !visible) return;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    readColors();
    layout();
    draw();

    const ro = new ResizeObserver(() => {
      layout();
      draw();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e?.isIntersecting ?? false;
      if (visible) start();
      else stop();
    });
    io.observe(canvas);
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
    };
    const onLeave = () => {
      pointer.x = pointer.y = -9999;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);
    const theme = new MutationObserver(() => {
      readColors();
      draw();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      theme.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      drawRef.current = null;
    };
  }, [shots, progress, reduced]);

  // Con «reducir movimiento» no hay bucle: se redibuja solo cuando cambia el progreso del scroll.
  useMotionValueEvent(progress, 'change', () => {
    if (reduced) drawRef.current?.();
  });

  return (
    <canvas ref={canvasRef} className={className} aria-hidden="true">
      {`Mapa de ${String(shots.length)} remates de Boca Juniors que se transforma en la letra Θ.`}
    </canvas>
  );
}
