import { describe, expect, it } from 'vitest';

import { readPublicEnv } from './env';

const URL_OK = 'https://proyecto.supabase.co';

/** Arma un JWT sin firma válida, solo para probar la lectura del rol. */
function fakeJwt(role: string): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '');
  return `${encode({ alg: 'HS256' })}.${encode({ role })}.firma`;
}

describe('readPublicEnv', () => {
  it('acepta la clave publicable', () => {
    const env = readPublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: URL_OK,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdefghijklmnop',
    });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(URL_OK);
  });

  it('acepta la clave anon heredada', () => {
    expect(() =>
      readPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: URL_OK, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: fakeJwt('anon') }),
    ).not.toThrow();
  });

  it('rechaza la clave secreta nueva', () => {
    expect(() =>
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: URL_OK,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abcdefghijklmnop',
      }),
    ).toThrow();
  });

  it('rechaza la service role heredada', () => {
    expect(() =>
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: URL_OK,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: fakeJwt('service_role'),
      }),
    ).toThrow();
  });

  it('rechaza URLs sin HTTPS o de otro dominio', () => {
    const key = 'sb_publishable_abcdefghijklmnop';
    expect(() =>
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://proyecto.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
      }),
    ).toThrow();
    expect(() =>
      readPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'https://evil.example.com',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
      }),
    ).toThrow();
  });

  it('falla si faltan variables', () => {
    expect(() => readPublicEnv({})).toThrow();
  });
});
