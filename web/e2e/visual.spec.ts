import { expect, test } from '@playwright/test';

// Regresión visual (16.7): las 5 interfaces en los dos temas. Los datos cambian con cada carga, así
// que se tapan gráficos, tablas y números y se compara el diseño (header, filtros, tarjetas,
// espaciado). Después de una carga con cambios grandes: `pnpm e2e --update-snapshots`.
test.skip(({ isMobile }) => isMobile, 'Solo escritorio');

const PAGES = ['/', '/equipo', '/jugadores', '/situaciones', '/comparar?jugador=6'];

for (const theme of ['light', 'dark'] as const) {
  for (const path of PAGES) {
    test(`${path} se ve igual (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'tema', value: theme, url: baseURL ?? 'http://localhost:3000' }]);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(path, { waitUntil: 'load' });
      await expect(page.locator('#contenido')).toBeVisible();
      await expect(page).toHaveScreenshot({
        mask: [page.locator('svg, table, canvas, .tabular, .tile-value, .freshness-strip')],
        maxDiffPixelRatio: 0.03,
        animations: 'disabled',
      });
    });
  }
}
