import { z } from 'zod';

// Validación de las variables de entorno públicas (sección 14.3: no confiar en nada externo,
// tampoco en la configuración). Si falta una o tiene forma rara, el error aparece al
// arrancar y no como una consulta rota en producción.

const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]{10,}$/;
const LEGACY_JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Devuelve el rol de un JWT heredado de Supabase (anon o service_role) sin verificar la firma. */
function jwtRole(token: string): string | undefined {
  const payload = token.split('.')[1];
  if (payload === undefined) return undefined;
  try {
    const json: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof json === 'object' && json !== null && 'role' in json && typeof json.role === 'string') {
      return json.role;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .url()
    .refine((value) => new URL(value).protocol === 'https:', 'Supabase tiene que usarse por HTTPS')
    .refine((value) => new URL(value).hostname.endsWith('.supabase.co'), 'La URL no es de un proyecto de Supabase'),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1)
    // Salvaguarda: si alguien pega por error la clave secreta, la web no arranca.
    .refine((value) => !value.startsWith('sb_secret_'), 'Nunca uses la clave secreta en la web')
    .refine(
      (value) => PUBLISHABLE_KEY.test(value) || (LEGACY_JWT.test(value) && jwtRole(value) === 'anon'),
      'Se espera una clave publicable (sb_publishable_...) o la clave anon heredada',
    ),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function readPublicEnv(source: Record<string, string | undefined> = process.env): PublicEnv {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
