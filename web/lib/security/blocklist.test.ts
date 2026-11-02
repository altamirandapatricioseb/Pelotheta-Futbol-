import { describe, expect, it } from 'vitest';

import { isScannerPath } from './blocklist';

describe('rutas de escáneres', () => {
  it.each([
    '/wp-admin/',
    '/wp-login.php',
    '/.env',
    '/.git/config',
    '/phpmyadmin/index.php',
    '/backup.sql',
    '/config.yml',
    '/api/.env',
    '/xmlrpc.php',
  ])('bloquea %s', (path) => {
    expect(isScannerPath(path)).toBe(true);
  });

  it.each([
    '/',
    '/jugadores',
    '/jugador/6',
    '/estadistica/goles',
    '/api/health',
    '/openapi.json',
    '/.well-known/security.txt',
    '/partido/49',
    '/envios',
  ])('deja pasar %s', (path) => {
    expect(isScannerPath(path)).toBe(false);
  });
});
