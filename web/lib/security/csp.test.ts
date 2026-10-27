import { describe, expect, it } from 'vitest';

import { buildCsp, createNonce } from './csp';

const base = { nonce: 'abc123', supabaseOrigin: 'https://proyecto.supabase.co' };

describe('buildCsp', () => {
  it('en producción no permite eval y fuerza HTTPS', () => {
    const csp = buildCsp({ ...base, isDev: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('bloquea objetos, base y que el sitio se embeba en otro', () => {
    const csp = buildCsp({ ...base, isDev: false });
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('solo conecta con el propio sitio y con Supabase', () => {
    const csp = buildCsp({ ...base, isDev: false });
    expect(csp).toContain("connect-src 'self' https://proyecto.supabase.co");
  });

  it("'unsafe-inline' aparece solo en style-src", () => {
    const csp = buildCsp({ ...base, isDev: false });
    const withInline = csp.split('; ').filter((directive) => directive.includes("'unsafe-inline'"));
    expect(withInline).toEqual(["style-src 'self' 'unsafe-inline'"]);
  });

  it('en desarrollo agrega unsafe-eval para React', () => {
    expect(buildCsp({ ...base, isDev: true })).toContain("'unsafe-eval'");
  });
});

describe('createNonce', () => {
  it('genera valores distintos de 128 bits en base64', () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toEqual(b);
    expect(atob(a)).toHaveLength(16);
  });
});
