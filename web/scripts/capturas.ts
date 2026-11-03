// Capturas del manual y del README (sección 15): las 5 interfaces y la desglosada en los dos temas.
// Se actualizan solas con cada cambio: `node scripts/capturas.ts` desde web/ con el sitio corriendo
// (BASE_URL, por defecto http://localhost:3000). Escribe en docs/capturas/.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = fileURLToPath(new URL('../../docs/capturas/', import.meta.url));
const PAGES: [string, string][] = [
  ['graficos', '/'],
  ['equipo', '/equipo'],
  ['jugadores', '/jugadores'],
  ['situaciones', '/situaciones'],
  ['comparar', '/comparar?jugador=6'],
  ['desglosada', '/estadistica/goles?entidad=jugador&id=6'],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const theme of ['light', 'dark'] as const) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'tema', value: theme, url: BASE }]);
  const page = await context.newPage();
  for (const [name, path] of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    // El indicador de `next dev` no es parte del sitio.
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.screenshot({ path: `${OUT}${name}-${theme === 'light' ? 'claro' : 'oscuro'}.png` });
  }
  await context.close();
}
await browser.close();
console.log(`${String(PAGES.length * 2)} capturas en ${OUT}`);
