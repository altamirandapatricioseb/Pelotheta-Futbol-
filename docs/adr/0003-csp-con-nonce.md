# ADR 0003: CSP con nonce por request

- Estado: aceptada (27-oct-2026, etapa 1)

## Contexto
Un sitio público sin login sigue siendo blanco de XSS (por ejemplo, por datos de terceros mal escapados).

## Decisión
- `web/proxy.ts` genera un nonce de 128 bits por request y arma la CSP: `script-src 'self' 'nonce-…' 'strict-dynamic'`, sin `'unsafe-eval'` ni `'unsafe-inline'` en scripts.
- `style-src` admite `'unsafe-inline'` porque Next.js y las animaciones inyectan estilos en línea; el riesgo de estilos inline es mucho menor que el de scripts.

## Consecuencias
- El nonce obliga a renderizado dinámico (`force-dynamic`). Los datos igual se cachean en `fetch` (6 h) para no golpear Supabase en cada visita.
