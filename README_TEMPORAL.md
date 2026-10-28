# README temporal: estado del proyecto

Registro vivo: dónde estamos, qué falta, qué quedó a medias o falló. Actualizado el 28-oct-2026.
Para retomar en un chat nuevo: leer este archivo, `PROMPT-1-BOCA-FUTBOL.md` (ya recortado) y
`docs/source_audit.md`.

## Etapas (sección 3.1 del prompt)

| Etapa | Estado |
|---|---|
| 1. Preparación | Hecha (27-oct) |
| 2. Esqueleto desplegado | Hecha (27-oct) |
| 3. Pipeline completo | Hecha (28-oct): workflow corrido desde el botón con éxito y fecha nueva visible en la web |
| 4. Estadísticas, métricas propias y tablas | **Desplegada** (28-oct): Interfaces 2 y 3 en producción; quedan pendientes menores (ver abajo) |
| 5. Gráficos (Interfaz 1) | **Desplegada** (28-oct): 103 gráficos en producción, 95 con datos y 8 «sin datos» con motivo |
| 6. Situaciones y estadística desglosada | Pendiente |
| 7. Comparación directa | Pendiente |
| 8. Excel | Pendiente |
| 9. Power BI | Pendiente |
| 10. Pulido | Pendiente |
| 11. Documentación y entrega | Pendiente |

## Etapa 3: cierre (28-oct-2026)

- URL: https://pelotheta-futbol.vercel.app/ — `/actualizar` con el botón (Interfaz 6).
- **Criterio cumplido:** corridas desde el botón el 28-oct a las 02:52 UTC y a las 03:55 UTC, las dos
  exitosas (unos 4 minutos con la caché). Después de la segunda, `/actualizar` y el header muestran
  «28/10/2026, 00:59» (hora argentina).
- Fuentes activas (detalle y permisos en `docs/source_audit.md` y `docs/security/compliance_register.md`):
  Promiedos (principal), ScoutingStats, Statshub (API de su web, con autorización explícita del dueño),
  Bzzoiro (clave), StrikerAPI (clave, 500 créditos/mes), NoFluffPicks, Open-Meteo, Wikipedia.
- **StrikerAPI sin créditos este mes:** responde HTTP 402. El pipeline sigue sin ella y conserva sus datos
  anteriores (1585 filas por jugador, 930 por equipo y 750 tiros). Se recarga el mes que viene.
- Base: 48 partidos de Boca 2026, unas 35 500 estadísticas por jugador, 25 MB de 500 MB.
- `.github/workflows/update.yml` (día 1 de cada mes y botón) y `.github/workflows/keepalive.yml` (lunes y
  jueves, sección 8.4).
- Botón: `POST /api/actualizar` dispara el workflow; verificación de Origin, enfriamiento de 60 min,
  estado cada 10 s y paso fallido visible en la página. Cuando una corrida termina bien, la web descarta
  su caché de datos (si no, la fecha nueva tardaba hasta 6 horas en verse).

### Qué falló y cómo se resolvió

1. **Dos corridas fallaron sin dejar rastro** (27-oct, 36 min; 28-oct 00:49 UTC, 44 min). Causa: el
   secret `SUPABASE_URL` terminaba en `.supabase.com` (copiado del `.env` local, que tenía el mismo
   error); la correcta termina en `.supabase.co`. El scraping terminaba y la carga se rechazaba por la
   forma de la URL; el registro del fallo usaba la misma URL y también fallaba. Arreglo: el pipeline
   limpia la URL y la clave, las valida y prueba una lectura a la base **antes** del scraping (si algo
   está mal, corta en segundos con un mensaje claro), y cualquier error inesperado queda en `ingest_log`.
   El dueño volvió a crear los secrets `SUPABASE_URL` y `SUPABASE_SECRET_KEY` el 28-oct.
2. **Claves expuestas, decisión del dueño (28-oct):** el `.env` completo (secreta de Supabase,
   StrikerAPI, Bzzoiro, API-Football) quedó en el chat por una captura. El dueño decidió **no rotarlas**.
   Riesgo aceptado y registrado (R01 en `docs/security/risk_register.csv`).

### Cierre de seguridad 14.9 de la etapa 3

- Security Advisor: 0 ERROR, 0 WARN, 2 INFO intencionales (`docs/security/advisors.md`).
- Cabeceras verificadas en la URL real: CSP con nonce, HSTS con preload, COOP, Permissions-Policy,
  nosniff, `X-Frame-Options: DENY`.
- `docs/security/risk_register.csv` creado (13 riesgos) y revisado.
- Falta confirmar el CI en verde: el repo es privado y se ve en GitHub (pestaña Actions, workflow «CI»).

### Pendientes que no bloquean

1. Eventos de StrikerAPI: 15 de 31 partidos (el resto llega cuando se recarguen los créditos).
2. Mails de permiso enviados (SporLens, ScoutingStats, PitchMath, GoalPulz): sin respuesta todavía.
3. Aviso automático si la base pasa los 400 MB (sección 7): el tamaño se mide en cada carga, el aviso
   falta.
4. Identidades duplicadas entre fuentes: «J. Barinaga» y «Juan Barinaga» figuran como dos jugadores
   (lo mismo puede pasar con «G. Gelini»).

## Cómo probar

```bash
uv sync && uv run pytest -q
uv run python -m pipeline.run
```

Con `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en el entorno, `tests/test_rls.py` prueba la base real.

```bash
cd web && corepack pnpm@10.34.9 install && corepack pnpm@10.34.9 dev
```

Si Supabase se pausa por inactividad (plan gratis, 7 días): entrar al panel de Supabase, abrir el
proyecto `pelotheta-futbol` y tocar «Restore project». El keepalive de lunes y jueves debería evitarlo.

## Etapa 4: estado (28-oct-2026)

Criterio («ambas interfaces muestran una tabla a la vez con sus descripciones»): **cumplido en producción**.

- **Catálogo:** `data/stat_catalog.csv` con 160 estadísticas de jugador y 184 de equipo (A 157, B 175, C 12), cada
  una con descripción propia y regla de cálculo; `data/stat_sets.csv` con los 11 conjuntos de 9.1 y los 14 de 9.5.
  Resumen y reemplazos posibles en `docs/catalogo_estadisticas.md`.
- **Base:** valores por partido (`sql/player_match_value.sql`, `sql/team_match_value.sql`) y tablas maestras
  materializadas que refresca el pipeline (la web lee resultados ya calculados, en milisegundos).
- **Métricas propias** (`pipeline/own_metrics.py`, se calculan al final de cada corrida): Elo propio con
  probabilidades previas, sorpresa y Brier; xPts por Poisson; exponente pitagórico calibrado (x = 1,29); rachas,
  forma, rotación, estabilidad del once, concentración de goles, edad; NR, NR relativo, EWA y ELA; índice de
  rendimiento, Mejoría α y β y Potencial α y β (6.1), con los ejemplos del prompt en tests. Ver
  `docs/metricas_propias.md` y `docs/model_cards/mejoria_potencial.md`.
- **Interfaz 3** (`/jugadores`): desplegable de conjuntos y Personalizado, por 90, filtros, percentiles, estimadas,
  porteros aparte, aviso de muestra pequeña. **Interfaz 2** (`/equipo`): vistas por partido, rival, mes,
  competición y acumulada, con total y promedio al pie.
- Revisión de código de cierre hecha: 5 correcciones aplicadas. Security Advisor: 0 ERROR, 0 WARN.

Pedidos del dueño (28-oct), hechos: el primer clic en un encabezado solo elige la estadística y los siguientes
ordenan de menor a mayor, de mayor a menor y vuelven al original; la primera columna ordena por fecha o nombre;
las 344 estadísticas tienen guía de lectura («más alto es mejor», «negativo: menos de lo esperado»...); la vista
acumulada del equipo es un tablero de tarjetas con línea partido a partido; las métricas de ventana también
existen por partido.

Pendientes de la etapa 4: **cerrados** (28-oct).

1. Filas «Promedio de la liga» y «Boca vs liga (percentil)» en la Interfaz 2 (y una línea «Liga» en cada tarjeta),
   con los promedios por partido de los 30 clubes.
2. NR con xG calculado (xG de los tiros con minuto que caen con el jugador en cancha, solo liga).
3. Parámetros de 6.1 y del Elo en `core.projection_param` (versión y fecha); el pipeline los lee antes de calcular.
4. Accesibilidad de las tablas: nombre explícito en los desplegables, `aria-sort` en todos los encabezados
   ordenables, tablero como lista de botones con `aria-pressed`.
5. Elo sin partidos duplicados: 33 partidos fechados con un día de diferencia entre Promiedos y StrikerAPI.
6. `n/d` (no 0) para los datos que el jugador nunca tuvo en la ventana (por ejemplo, solo de liga).

Pasan a la etapa 6 por definición: la serie partido a partido de 6.1 «a la fecha» y el doble clic a la
estadística desglosada.

## Etapa 5: estado (28-oct-2026)

Criterio («todos los gráficos con datos disponibles funcionan en producción; los que no tienen datos figuran
«sin datos» y se informa cuántos de los 50 funcionan»): **cumplido**. De los 103 gráficos del catálogo, **95
funcionan con datos reales** (el piso de 50 se supera) y 8 muestran la tarjeta «sin datos» con su motivo.

- **Catálogo:** `data/chart_catalog.csv` (103 gráficos en 17 categorías, A a Q, con tipo, datos que necesita,
  conjunto de origen y si se lleva a Power BI y Excel) y `data/chart_source_map.csv` (destino del botón «Ver
  origen de los datos»). El pipeline los carga en cada corrida con `ingest.load_charts` a `core.chart_catalog` y
  `core.chart_source_map` (RLS de solo lectura, vistas `api.chart_catalog` y `api.chart_source_map`).
- **Landing `/`:** barra de categorías fija que resalta la sección actual, filtros globales de competición y
  localía, 2 a 4 números destacados por sección y grilla de 1 a 3 columnas. Cada gráfico: título, número,
  fuente, fecha, cobertura («dato en 45 de 48 partidos»), tooltip, tabla equivalente, PNG, CSV (sin fórmulas
  ejecutables) y «Ver origen» con tooltip «Origen: Equipo › Resultados». Los 24 destinos responden 200.
- **Gráficos SVG propios** (`web/components/charts/`), paleta validada en claro y oscuro (sin violeta), un solo eje
  por gráfico, leyenda desde dos series y resultado G/E/P nunca solo por color.
- **Categoría N alineada con 6.1.6** (gráficos 78 a 84). El rango de ± 8 del Potencial α y la curva del margen
  esperado salen de `core.projection_param`, no están fijos en el código.
- **Tests:** catálogo y mapa sin enlaces rotos (prueba obligatoria de 9.9), cada gráfico con datos tiene dibujo,
  Spearman y transformaciones. Python 204, web 62.
- **Cierre de diseño (impeccable audit y polish):** 14/20 antes de corregir. Se quitó el borde lateral de los
  números destacados, la tabla oculta repetida en cada tarjeta (de 22.142 a 9.378 nodos), el anuncio del
  tooltip a lectores de pantalla y el desborde horizontal en 375 px; se agregó `content-visibility` y texto de
  ejes más grande en móvil.
- **Seguridad 14.9:** Security Advisor 0 ERROR y 0 WARN (2 INFO de tablas privadas sin política, a propósito);
  sin secretos en el diff; parámetros de la URL de origen validados contra lista cerrada.

Pedidos del dueño (28-oct, después del despliegue), hechos: verde principal #64cc4f (rampa del mismo matiz; en
modo claro el texto verde usa el escalón oscuro #1e7801 para llegar a AA); en los paneles de contexto el valor es
verde si es el mejor del plantel, de la tabla o de los 30 clubes de la liga y rojo si es el peor, siempre con una
etiqueta de texto (el rojo #fe897d tiene la misma luminosidad y croma que el verde; el complementario estricto es
violeta y está prohibido); la franja «Última actualización» quedó solo en Actualizar; botón de modo claro y
oscuro en el header (cookie `tema`, sin destello); fondo con tinte verde y brillo, tarjetas un escalón más claras
y con sombra en los dos modos. Tipografía confirmada: Montserrat 400 a 800 servida por el propio sitio.

Paleta del dueño (28-oct, segunda ronda): fondo liso #fbfbfd o #222222, verdes #328336, #64cc4f y #b2e05b,
header más oscuro en modo oscuro y encabezados de tabla con tinte verde. Gráficos en orden verde, rojo, azul,
amarillo y rosa (validado con daltonismo: el rojo va más oscuro que el verde para distinguirse). Encabezados:
«Rival», «Mes», «Competición» con mayúscula y, en Jugadores, «Arqueros», «Defensores», «Mediocampistas» o
«Delanteros» según el filtro («Jugadores» con todos).

Sin datos (8): 03 evolución de la tabla (solo hay tabla final), 14 primer gol (etapa 6), 26 pases progresivos y
33 presiones (ninguna fuente gratuita los publica), 66 marcador por minuto (etapa 6), 80, 81 y 82 de 6.1 (serie
por partido, componentes del índice y desglose del Potencial: etapa 6).

Pendientes que no bloquean: el interruptor propio para reducir animaciones (9.10) llega en la etapa 10; mientras
tanto se respeta la preferencia del sistema. El doble clic hacia la estadística desglosada llega con la etapa 6.

## Próxima etapa (6: Situaciones y estadística desglosada)

Skills: `impeccable` (`shape` y `animate`) antes de escribir el tablero tipo Miro,
`animation-components:animated-component-libraries` al implementar el lienzo, cierre con `impeccable` (`audit` y
`polish`). Al terminarla se completan los gráficos 14, 66, 80, 81 y 82.
