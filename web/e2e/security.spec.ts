import { expect, test } from '@playwright/test';

// Seguridad de punta a punta (14.3): CSP con nonce, parámetros maliciosos y sondas de escáneres.
// Corre solo en escritorio: lo que se mide es el servidor, no el dispositivo.
test.skip(({ isMobile }) => isMobile, 'Solo escritorio');

const PAYLOAD = '<script>alert(1)</script>';

test('la CSP lleva nonce y todos los scripts lo usan', async ({ page }) => {
  const response = await page.goto('/jugadores', { waitUntil: 'load' });
  const csp = response?.headers()['content-security-policy'] ?? '';
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce, 'la CSP tiene que tener nonce').toBeTruthy();
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  // Los scripts del HTML que manda el servidor; los que estos cargan después heredan la confianza
  // por 'strict-dynamic' (por ejemplo, la recarga en caliente del modo desarrollo).
  const html = (await response?.text()) ?? '';
  const tags = html.match(/<script\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) expect(tag, tag.slice(0, 80)).toContain(`nonce="${nonce ?? ''}"`);
});

for (const path of [
  `/jugadores?comp=${encodeURIComponent(PAYLOAD)}`,
  `/equipo?conjunto=${encodeURIComponent(PAYLOAD)}&estadistica=${encodeURIComponent("' or 1=1--")}`,
  `/comparar?jugador=${encodeURIComponent(PAYLOAD)}`,
  `/estadistica/${encodeURIComponent(PAYLOAD)}?entidad=jugador&id=6`,
  `/estadistica/goles?entidad=${encodeURIComponent(PAYLOAD)}&id=6`,
  `/jugador/${encodeURIComponent('6; drop table core.match')}`,
]) {
  test(`parámetros maliciosos sin reflejo ni error: ${path.slice(0, 60)}`, async ({ page }) => {
    let dialog = false;
    page.on('dialog', (d) => {
      dialog = true;
      void d.dismiss();
    });
    const response = await page.goto(path, { waitUntil: 'load' });
    expect(response?.status(), 'nunca un 500').toBeLessThan(500);
    const html = await page.content();
    expect(html).not.toContain(PAYLOAD);
    expect(dialog, 'no se ejecutó ningún script inyectado').toBe(false);
  });
}

test('las sondas de escáneres reciben 404 sin página', async ({ request }) => {
  for (const path of ['/wp-login.php', '/.env', '/.git/config', '/phpmyadmin/']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
  }
  expect((await request.get('/.well-known/security.txt')).status()).toBe(200);
});
