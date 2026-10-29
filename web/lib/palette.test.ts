// Regla de color (9.10, cambio del 28-oct-2026): ningún violeta salvo los dos permitidos como
// secundario (#734f9a y #965fd4). Recorre los colores hexadecimales de los estilos de la web.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ALLOWED = new Set(['#734f9a', '#965fd4']);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function hue(hex: string): { h: number; s: number } {
  const n =
    hex.length === 4
      ? [1, 2, 3].map((i) => parseInt(hex.charAt(i).repeat(2), 16))
      : [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r, g, b] = n.map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(max + min - 1)) };
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(css|tsx?)$/.test(name) ? [path] : [];
  });
}

describe('paleta', () => {
  it('sin violetas fuera de los dos permitidos', () => {
    const bad: string[] = [];
    for (const file of [
      ...files(join(ROOT, 'app')),
      ...files(join(ROOT, 'components')),
      ...files(join(ROOT, 'styles')),
    ]) {
      for (const m of readFileSync(file, 'utf-8').matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
        const hex = m[0].toLowerCase();
        const { h, s } = hue(hex);
        if (s > 0.15 && h >= 255 && h <= 335 && !ALLOWED.has(hex)) bad.push(`${file}: ${hex}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('los dos violetas permitidos son violetas', () => {
    for (const hex of ALLOWED) expect(hue(hex).h).toBeGreaterThan(255);
  });
});
