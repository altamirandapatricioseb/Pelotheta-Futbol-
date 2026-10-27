import { existsSync } from 'node:fs';
import path from 'node:path';

import type { NextConfig } from 'next';

// Imágenes de marca opcionales (las suelta el dueño en public/brand/). Se buscan en el build y
// la ruta encontrada queda como variable pública; si no hay ninguna, la variable queda vacía.
function findBrandAsset(baseName: string): string {
  for (const ext of ['svg', 'webp', 'png']) {
    if (existsSync(path.join(process.cwd(), 'public', 'brand', `${baseName}.${ext}`)))
      return `/brand/${baseName}.${ext}`;
  }
  return '';
}

// Cabeceras de seguridad fijas para todas las rutas (sección 14.3). La CSP no va acá porque
// lleva un nonce distinto en cada request: la arma `proxy.ts`. Estas se definen en la
// configuración (y no solo en el proxy) para que se apliquen aunque el proxy no corra.
const securityHeaders = [
  // Obliga a HTTPS durante 2 años, también en subdominios, y permite la lista de precarga.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // El navegador no adivina tipos de archivo: evita que un .txt se ejecute como script.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Al salir del sitio solo se envía el origen, nunca la URL completa con sus filtros.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Apaga APIs del navegador que el sitio no usa.
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=(), browsing-topics=()',
  },
  // Aísla la ventana de otras pestañas abiertas desde el sitio.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Respaldo para navegadores viejos de `frame-ancestors 'none'`: no se puede embeber.
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_TEAM_PHOTO: findBrandAsset('team'),
    NEXT_PUBLIC_SYSTEM_LOGO: findBrandAsset('system-logo'),
  },
  poweredByHeader: false,
  reactStrictMode: true,
  // Sin mapas de código en producción: no regalamos el código fuente legible.
  productionBrowserSourceMaps: false,
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default nextConfig;
