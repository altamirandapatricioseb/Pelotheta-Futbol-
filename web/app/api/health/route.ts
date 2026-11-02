import { NextResponse } from 'next/server';

import { readPublicEnv } from '@/lib/env';

// Salud del sistema (sección 14.6): estado de la base, última carga y versión desplegada. Nada
// sensible. La consulta salta la caché de datos (`no-store`) para medir la base de verdad; la
// consulta el workflow `health.yml` cada 6 horas.

export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 5000;

export async function GET() {
  const env = readPublicEnv();
  const version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local';
  let lastUpdate: string | null = null;
  let database: 'ok' | 'sin_respuesta' = 'sin_respuesta';
  try {
    const res = await fetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/system_status?select=updated_at&key=eq.ultima_actualizacion`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
          'Accept-Profile': 'api',
        },
      },
    );
    if (res.ok) {
      const rows = (await res.json()) as { updated_at: string | null }[];
      database = 'ok';
      lastUpdate = rows[0]?.updated_at ?? null;
    }
  } catch {
    // Base pausada, caída o lenta: se informa como sin respuesta, sin detalles internos.
  }
  const ok = database === 'ok';
  return NextResponse.json(
    { estado: ok ? 'ok' : 'degradado', base: database, ultima_carga: lastUpdate, version },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
