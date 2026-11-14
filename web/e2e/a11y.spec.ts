import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Todas las rutas con datos reales: el jugador con más minutos (6), el último partido (49) y una
// estadística de cada entidad.
const ROUTES = [
  '/',
  '/graficos',
  '/elegir',
  '/elegir?pais=argentina&categoria=primera-division&equipo=boca-juniors',
  '/equipo',
  '/jugadores',
  '/situaciones',
  '/comparar?jugador=6',
  '/actualizar',
  '/jugador/6',
  '/partido/49',
  '/estadistica/goles?entidad=jugador&id=6',
  '/estadistica/eq_xg?entidad=equipo',
  '/estado',
  '/privacidad',
  '/api-docs',
  '/soporte',
];

for (const theme of ['light', 'dark'] as const) {
  for (const route of ROUTES) {
    test(`${route} sin problemas de accesibilidad (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'tema', value: theme, url: baseURL ?? 'http://localhost:3000' }]);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      // `load` y no `networkidle`: el servidor de desarrollo deja conexiones abiertas y la espera se cuelga.
      await page.goto(route, { waitUntil: 'load' });
      await expect(page.locator('#contenido')).toBeVisible();
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const summary = violations.map(
        (v) =>
          `${v.id} (${v.impact ?? 'sin impacto'}): ${String(v.nodes.length)} × ${v.nodes[0]?.target.join(' ') ?? ''}`,
      );
      expect(summary).toEqual([]);
    });
  }
}

for (const route of ROUTES) {
  test(`${route} sin desplazamiento horizontal`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'load' });
    await expect(page.locator('#contenido')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
