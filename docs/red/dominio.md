# Red y dominio (16.10)

El sitio usa el dominio de Vercel (`pelotheta-futbol.vercel.app`); no hay dominio propio. Este documento
explica el recorrido de red actual y qué hacer si se compra uno.

## Recorrido de una visita

1. **DNS:** `pelotheta-futbol.vercel.app` resuelve a la red anycast de Vercel, que lo administra.
2. **TLS:** certificado de Vercel con TLS 1.2 o 1.3; HSTS de 2 años con `includeSubDomains` y `preload`
   lo envía el propio sitio (`web/next.config.ts`).
3. **Borde de Vercel:** mitigación de DDoS de la plataforma. El proxy del sitio corta con 404 las sondas de
   escáneres y agrega la CSP con nonce.
4. **Función de Next.js:** arma la página; los datos salen de la Data API de Supabase por HTTPS
   (`*.supabase.co`), con caché de 6 horas.
5. **Base:** Postgres de Supabase, de solo lectura para la clave pública (RLS).

Verificación: `curl -sSI https://pelotheta-futbol.vercel.app` muestra las cabeceras, y el control semanal
de seguridad las compara con la política.

## Si se compra un dominio

1. En el registrador, apuntar el dominio a Vercel (`A @ 76.76.21.21` y `CNAME www cname.vercel-dns.com`, o
   delegar los NS a Vercel) y agregarlo en Vercel → Settings → Domains.
2. **CAA:** `0 issue "letsencrypt.org"`, para que solo esa autoridad pueda emitir certificados.
3. **DNSSEC:** activarlo si el registrador lo ofrece.
4. **HSTS preload:** con el dominio estable, enviarlo a hstspreload.org.
5. Actualizar `Canonical` en `security.txt`, `metadataBase` y la URL de `health.yml` y
   `security_weekly.yml`.
6. Verificar: `dig CAA <dominio>`, `dig +dnssec <dominio>`, SSL Labs con nota A o A+ y `/api/health`.
