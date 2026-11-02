import { NextResponse, type NextRequest } from 'next/server';

import { isScannerPath } from '@/lib/security/blocklist';
import { buildCsp, createNonce } from '@/lib/security/csp';

// El proxy (antes "middleware") agrega la CSP con nonce y corta con 404 las sondas de escáneres
// (lib/security/blocklist.ts). Ninguna protección del
// sistema depende de él: la última línea de defensa es la RLS de la base (sección 14.3,
// por vulnerabilidades como CVE-2025-29927, que permitía saltear el middleware).
export function proxy(request: NextRequest) {
  if (isScannerPath(request.nextUrl.pathname)) return new NextResponse(null, { status: 404 });
  const nonce = createNonce();
  const supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://invalid.supabase.co').origin;
  const csp = buildCsp({ nonce, isDev: process.env.NODE_ENV === 'development', supabaseOrigin });

  // Next.js lee el nonce de la cabecera CSP del request y lo aplica a sus propios scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Archivos estáticos e imágenes no necesitan CSP (no son documentos HTML).
      source: '/((?!_next/static|_next/image|favicon.ico|brand/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
