import { NextResponse, type NextRequest } from 'next/server';

import { dispatch, latestRun, readConfig, UpdateError } from '@/lib/update/github';
import { updateState } from '@/lib/update/state';
import { getUpdateStatus } from '@/lib/update/status';

// Botón «Actualizar» (Interfaz 6, ADR 0004).
// GET: estado de la última corrida (la página lo consulta cada 10 s mientras corre).
// POST: dispara el workflow si no hay una corrida en curso ni dentro del enfriamiento.
// Las respuestas nunca incluyen detalles internos (ni el token ni mensajes de GitHub).

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

function originHost(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export async function GET() {
  const status = await getUpdateStatus();
  return NextResponse.json(status, { status: status.state === 'unavailable' ? 502 : 200, headers: noStore });
}

export async function POST(request: NextRequest) {
  // Solo desde la propia web: un sitio ajeno no puede disparar corridas con un formulario.
  if (originHost(request.headers.get('origin')) !== request.nextUrl.host) {
    return NextResponse.json({ error: 'origen no permitido' }, { status: 403, headers: noStore });
  }
  const config = readConfig();
  if (!config) return NextResponse.json({ state: 'unconfigured' }, { status: 503, headers: noStore });
  try {
    const current = updateState(await latestRun(config));
    if (current.state !== 'idle') return NextResponse.json(current, { status: 409, headers: noStore });
    await dispatch(config);
    return NextResponse.json({ state: 'running', nextAvailableAt: null, lastRun: null }, { status: 202, headers: noStore });
  } catch (error) {
    const status = error instanceof UpdateError ? 502 : 500;
    return NextResponse.json({ state: 'unavailable' }, { status, headers: noStore });
  }
}
