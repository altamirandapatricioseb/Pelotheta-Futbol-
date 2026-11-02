import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { articleUrl, ERRORS, type ErrorCode } from './errors';

const SOPORTE = fileURLToPath(new URL('../../docs/soporte/', import.meta.url));

describe('códigos de error', () => {
  it('cada código tiene formato estable, explicación pública y artículo de mantenimiento', () => {
    for (const code of Object.keys(ERRORS) as ErrorCode[]) {
      expect(code).toMatch(/^PEL-[A-Z]+-\d{3}$/);
      expect(existsSync(`${SOPORTE}${code}.md`), code).toBe(true);
      expect(articleUrl(code)).toBe(`/soporte#${code}`);
      expect(ERRORS[code].causes.length, code).toBeGreaterThan(0);
      expect(ERRORS[code].fix.length, code).toBeGreaterThan(0);
    }
  });
});
