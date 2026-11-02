import { defineConfig, devices } from '@playwright/test';

// Recorridos de punta a punta y accesibilidad. Sin E2E_BASE_URL levanta `next dev` con .env.local;
// con E2E_BASE_URL (por ejemplo, producción) prueba ese sitio sin levantar nada.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
    { name: 'celular', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'pnpm dev', url: baseURL, reuseExistingServer: true, timeout: 180_000 },
});
