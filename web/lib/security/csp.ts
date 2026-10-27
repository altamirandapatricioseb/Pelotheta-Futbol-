// Construcción de la Content-Security-Policy (sección 14.3).
//
// Por qué un nonce: Next.js inyecta scripts en línea para hidratar la página. Con un nonce
// aleatorio por request, el navegador ejecuta solo esos scripts y cualquier script inyectado
// por un atacante queda bloqueado. 'strict-dynamic' deja que esos scripts carguen sus propios
// módulos sin listar dominios.
//
// Por qué 'unsafe-inline' en style-src: las animaciones (motion) escriben estilos en línea.
// Es la única excepción que permite el diseño y no habilita ejecución de código. Está
// justificada en docs/adr/0003-csp-con-nonce.md.

export interface CspOptions {
  nonce: string;
  isDev: boolean;
  /** Origen del proyecto de Supabase, por ejemplo https://abc.supabase.co */
  supabaseOrigin: string;
}

export function buildCsp({ nonce, isDev, supabaseOrigin }: CspOptions): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // 'unsafe-eval' solo en desarrollo: React lo usa para reconstruir pilas de errores.
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'blob:', 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", supabaseOrigin],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'manifest-src': ["'self'"],
    'worker-src': ["'self'", 'blob:'],
  };

  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (!isDev) {
    parts.push('upgrade-insecure-requests');
  }
  return parts.join('; ');
}

/** Genera un nonce de 128 bits en base64 con la API Web Crypto (disponible en el runtime del proxy). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
