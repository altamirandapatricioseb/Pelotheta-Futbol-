import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { articleUrl, ERRORS, reportUrl, type ErrorCode } from './errors';

const SOPORTE = fileURLToPath(new URL('../../docs/soporte/', import.meta.url));

describe('códigos de error', () => {
  it('cada código tiene formato estable y su artículo de soporte', () => {
    for (const code of Object.keys(ERRORS) as ErrorCode[]) {
      expect(code).toMatch(/^PEL-[A-Z]+-\d{3}$/);
      expect(existsSync(`${SOPORTE}${code}.md`), code).toBe(true);
      expect(articleUrl(code)).toContain(`/docs/soporte/${code}.md`);
    }
  });

  it('el reporte abre la plantilla con la página completa y codificada', () => {
    const url = new URL(reportUrl('https://pelotheta-futbol.vercel.app/jugador/6?x=1&y=2'));
    expect(url.pathname).toMatch(/\/issues\/new$/);
    expect(url.searchParams.get('template')).toBe('dato_incorrecto.yml');
    expect(url.searchParams.get('pagina')).toBe('https://pelotheta-futbol.vercel.app/jugador/6?x=1&y=2');
  });
});
