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
| 6. Situaciones y estadística desglosada | **Desplegada** (28-oct): tablero, conclusiones, desglosada y doble clic; queda la página de partido (ver abajo) |
| 7. Comparación directa | **Desplegada** (28-oct): `/comparar` contra plantel, zona, carril, posición y otro jugador |
| 8. Excel | **Desplegada** (28-oct): 6 libros (global y uno por competición) que se descargan desde la web |
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

## Etapa 6: estado (28-oct-2026)

- **Situaciones (`/situaciones`, 9.6):** 132 tarjetas (las 131 del pedido y «Quién marca primero»), 123 con datos
  reales y 9 n/d con el dato que falta (pases al último tercio, progresivos, recuperaciones por zona, Field Tilt,
  duelos aéreos disputados, presiones, remates de pelota parada, bajas por suspensión y acumulación de amarillas).
  Todo se calcula en SQL (`sql/situational/*.sql`, una vista por categoría) y `core.refresh_situations` arma las
  filas al final de cada corrida. Lienzo con zoom (Ctrl + rueda, pellizco, botones), arrastre con inercia,
  minimapa, ajustar a pantalla, índice que centra cada marco, búsqueda, filtros, orden «Destacados» (sin filas
  de muestra pequeña) y «Ver los partidos» en cada fila.
- **Estadística desglosada (`/estadistica/[stat]`, 9.8):** serie y ventanas resueltas en SQL
  (`api.stat_series`, `api.stat_windows`, sin precalcular): último partido, últimos 3/5/10, 7 a 90 días desde el
  último partido cargado, mes, temporada, competición, localía, resultado y rival; gráficos partido a partido
  con promedios, media móvil, distribución, comparación con plantel/posición o liga y racha; lista de partidos
  ordenable y filtrable; contra quién; relacionadas.
- **Doble clic:** celdas de Jugadores y Equipo (también la tecla D), y 30 gráficos de la landing (más el enlace
  «Desglosada» al pie).
- **Serie de 6.1 partido a partido** «a la fecha» (sin datos futuros, con test): habilita el gráfico 80 y la
  desglosada de Mejoría y Potencial. Los gráficos 14 y 66 salen de las tarjetas de Situaciones. Landing: 98 de
  103 gráficos con datos.

Pedidos del dueño sobre Situaciones (28-oct), hechos: sin arrastrar (scroll e índice fijo); tarjetas en
columnas sin huecos y filas plegables; guía «Cómo leer las tarjetas» (qué es cada número, la flecha y los pp);
cada fila destaca su métrica principal y suma promedios de remates, xG, posesión, córners o tarjetas contra la
temporada. **Conclusiones** (botón aparte): 86 reglas en `data/conclusion_catalog.csv` → 41 del equipo (Boca en
todas sus competiciones contra la liga, copas contra liga, pelota parada, posiciones) y 74 de 26 jugadores
(percentil frente al plantel); verde, rojo o azul según la banda, recalculadas en cada corrida. En Jugadores y
Equipo, pasar el mouse (o el foco) por una columna muestra esa estadística en el panel. Gráficos 81 y 82 hechos
(landing: 100 de 103 con datos).

Pendientes de la etapa 6: revisión de diseño de cierre del tablero. El doble clic desde Comparar quedó hecho
en la etapa 7 y la página de partido, después de la etapa 7 (abajo).

**Página de partido (`/partido/[id]`, 28-oct):** marcador, competición, fecha y hora, estadio, árbitro,
formaciones y clima; goles con minuto y autor (de los remates; si la fuente no los trae, lo dice); cara a cara
Boca contra el rival (posesión, xG, remates, ocasiones, pases, córners, faltas y tarjetas); momentum; mapa de
remates de Boca; jugadores de Boca con 20 estadísticas del partido (doble clic: desglosada del jugador);
estadísticas del equipo contra su promedio de la temporada por grupo, con flecha de mejor o peor (doble clic:
desglosada del equipo); bajas; tarjetas de Situaciones donde aparece; partido anterior y siguiente. Datos de la
vista nueva `api.match_lineup` (alineación de Boca). Enlaces desde la desglosada (último partido y lista), el
panel de Equipo y los partidos de cada fila de Situaciones.

## Etapa 7: estado (28-oct-2026)

- **Comparar (`/comparar`, 9.7):** un jugador contra 1 a 3 referencias (media del plantel, de su zona, de su
  zona y carril, de su posición u otro jugador). La media de la liga en su posición figura deshabilitada: no hay
  datos de jugadores de otros equipos por posición. Período (temporada, últimos 5 o 10 partidos, último mes),
  competición, totales o por 90, mínimo de minutos y promedio simple o ponderado por minutos (se muestra cuál).
- **Reglas:** el jugador nunca entra en su propia media; arqueros solo contra arqueros (y suman la sección
  Porteros); verde = mejor según `higher_is_better`; filas grises «sin datos» que no cuentan en el resumen;
  muestra pequeña marcada (jugador y grupos de menos de 3); si la fuente solo da la línea, se avisa que zona y
  posición coinciden. Funciones puras en `web/lib/compare/compare.ts` con 24 tests.
- **Zona y posición:** tabla `core.position_zone_map` (mapeo de posiciones de las alineaciones a zona, carril y
  rol; también las cuatro líneas generales) y vista `api.player_position` (posición más repetida de cada jugador,
  con respaldo en la línea del plantel). Nuevas ventanas en `core.player_master_mv`: `ultimos5`, `ultimos10` y
  `ultimo_mes` (medidos desde el último partido cargado).
- **Qué se ve:** resumen (mejor/peor/igual contra cada referencia, 5 fortalezas y 5 debilidades por diferencia
  estandarizada sin contar minutos ni carga, radar del percentil medio por categoría); partido a partido de la
  estadística elegida contra la media por partido de cada referencia; una sección plegable por categoría con
  tabla (valor, media, diferencia absoluta y %, percentil, flecha) y gráficos alternables (radar de 3 a 8 ejes,
  barras divergentes, agrupadas y de bala). Barra de controles fija que se achica al bajar.
- **Doble clic** en una fila o un gráfico (también Enter o D): la desglosada con las referencias elegidas
  superpuestas (barras comparadas y líneas sobre cada partido) y «Volver» a la misma comparación.
- **Exportar:** PNG de cada gráfico y Excel (`.xlsx` con la hoja «Comparación», una tabla por categoría), armado
  en el navegador sin dependencias. La hoja interactiva «Comparador» del libro llega en la etapa 8.
- **Arreglo de la etapa 6:** `api.stat_series` usaba el id de la estadística como clave base en los compuestos
  (porcentajes, diferencias y sumas): 58 estadísticas (28 de jugador y 30 del equipo) no tenían serie ni
  ventanas en la desglosada. Ahora resuelve la clave base en el catálogo, como la tabla maestra.

Cierre de seguridad 14.9 de la etapa 7: advisors de Supabase sin hallazgos nuevos (solo los dos INFO de siempre:
`audit_log` y `source_id_map` sin políticas a propósito); `position_zone_map` con RLS y lectura pública;
`api.player_position` con `security_invoker`; prueba de RLS con la clave pública 36/36 (suma `player_position`).
Los parámetros de `/comparar` y la vuelta de la desglosada se validan con listas cerradas y expresiones regulares
(«volver» solo acepta rutas internas de Comparar); el Excel escribe textos como texto (nunca fórmulas).

Pendientes que no bloquean: el dato de penales del equipo tiene partidos con más convertidos que a favor (sale
200 % en `eq_pct_penales`); revisar la fuente en la etapa 10. Hay dos registros del mismo jugador (J. Barinaga y
Juan Barinaga) que vienen así de la fuente.

## Etapa 7, segunda vuelta y fase 7.5 (28-oct-2026, pedidos del dueño)

- **Con qué comparar:** se elige un jugador y UNA opción: media del equipo (sin arqueros), media de
  arqueros, defensores, mediocampistas o delanteros, media de su posición específica u otro jugador. Con otro
  jugador aparecen casillas para sumar medias. Colores fijos por entidad: jugador verde, otro jugador violeta,
  equipo azul, posición amarillo, arqueros rosa, defensores naranja, mediocampistas verde azulado y delanteros
  oliva. Paleta (pedido del dueño, 28-oct): verde principal, violeta secundario (solo junto al verde; #734f9a en
  claro y #965fd4 en oscuro), rojo solo para lo negativo, después azul y amarillo; validada con la skill dataviz.
  El verde #8bd450 queda fuera de las series: en oscuro es demasiado claro para la banda de luminosidad. Arranca vacía y tiene «Limpiar».
- **Selector único con búsqueda** (combobox): se escribe el nombre sin importar tildes y la lista sale agrupada
  por línea (arqueros, defensores, mediocampistas, delanteros). Enner Valencia aparece con «enner».
- **Estadísticas según las posiciones:** columna `lineas` en `data/stat_catalog.csv` (qué líneas usan cada
  estadística; base: `stat_catalog.lines`). Por defecto se ven las de las líneas que se comparan (arquero contra
  arquero, mediocampista contra delantero, etc.); «Todas» muestra el resto. Cruzar un arquero con un jugador de
  campo se permite y se avisa. Las categorías se ordenan según la línea del jugador.
- **Categorías de a una**, con un selector como Tarjetas/Conclusiones: Resumen, cada categoría y Desglose.
  Cada categoría tiene hasta tres radares de percentiles (lo principal, eficacia y volumen; las principales
  salen de la columna `clave` del catálogo), un gráfico a elección (diferencia %, barras lado a lado o sobre el
  rango del grupo) dibujado al ancho real del recuadro, con leyenda que dice qué es el punto y qué es la línea.
- **Fase 7.5: Desglose dentro de Comparar.** Se elige una estadística (o doble clic en una fila): el jugador y
  el otro jugador lado a lado, las medias como líneas, filtro propio (competición, localía, resultado),
  ventanas en grupos (últimos partidos, días, mes, competición, localía, resultado, titular o suplente, minutos
  jugados y rival), 8 gráficos (partido a partido, promedio móvil, distribución, por competición, resultado,
  localía, titularidad y mes) y los partidos de los dos con «no jugó» y la flecha de quién rindió mejor.
- La desglosada suelta (`/estadistica`) aclara de quién son las tarjetas y los partidos cuando se compara.

## Etapa 8: estado (28-oct-2026)

- **Libros** (`pipeline/excel.py`, `xlsxwriter`): uno global y uno por competición (6), ~110 a 225 KB. Hojas:
  `Índice` (enlaces a todas), `Metadatos`, `Tabla maestra` (paneles congelados, autofiltro, `n/d` en gris,
  escala de color por percentil según el sentido de cada estadística), `Catálogo`, `Comparador` (2 a 4 jugadores
  o medias y un conjunto con listas desplegables; `INDEX`/`MATCH` alimentan un radar de percentiles y barras
  nativos), `Dispersión` (eje X y eje Y a elección), `Comparación` (medias de equipo y de cada línea por
  categoría), `Equipo` (partido a partido) y, en el global, `Situaciones`. Gráficos nativos de la tabla 9.4:
  ranking por conjunto, distribución con cuartiles, evolución con media móvil, forma (combinado), goles por tramo,
  xG a favor y en contra, puntos contra xPts (con diagonal), minutos apilados, NR por signo y correlación con
  escala de color. Las hojas de la evolución de la tabla y del mapa de tiros explican por qué no hay gráfico.
  Cada hoja de gráfico lleva «Ver datos de origen» y «Volver al índice». Textos siempre como texto (lo que
  empieza con `=`, `+`, `-` o `@` lleva apóstrofo). Montserrat y la paleta de la web.
- **Storage:** bucket público `exports` (10 MB, solo xlsx, csv y png); se escribe solo con la clave secreta.
  El workflow mensual arma y sube los libros después del pipeline (si falla, avisa en el resumen sin marcar la
  corrida como fallida). Prueba de RLS: la clave pública no puede escribir y sí descargar (39/39).
- **Web:** botón «Descargar Excel» en Equipo, Jugadores y Comparar con los 6 libros. Las exportaciones de la
  vista actual (tablas y Comparar) ya existían.
- **Tests:** `tests/test_excel.py` (hojas, índice, gráficos nativos con radar y dispersión, interactividad,
  texto seguro, percentiles y medias).
- **No verificado:** el recálculo de fórmulas con Excel o LibreOffice (no hay ninguno instalado acá). Las
  fórmulas son de Excel 2007 (`INDEX`, `MATCH`, `IFERROR`, `NA`) y el libro pide recalcular al abrir.
- **Pendiente:** hoja `Proyección` con el cálculo paso a paso en fórmulas vivas (6.1) y hoja `Desglosada` con
  listas de estadística, entidad y ventana.

## Próxima etapa (9: Power BI)

Skills: las del plan para Power BI (`docs/skills_plan.md`); tema con la paleta nueva (verde, violeta
secundario, rojo solo para lo negativo).
