# Guía de Power BI

Power BI es el complemento local de la web: el repositorio no trae un `.pbix`, trae el modelo listo
para armarlo. Esta guía lleva de cero a las siete páginas del reporte (más la de Evolución y
proyección) y sigue, gráfico por gráfico, el cuadro 9.4 del pedido.

Qué hay en el repositorio:

| Archivo | Para qué |
|---|---|
| `data/powerbi/*.csv` | Modelo en estrella (19 tablas), UTF-8 con BOM y punto decimal. Lo genera `python -m pipeline.powerbi` |
| `powerbi/measures.dax` | Todas las medidas, los parámetros de hipótesis y las tablas de ejes |
| `powerbi/theme.json` y `powerbi/theme-oscuro.json` | Tema claro y oscuro con la paleta de la web y Montserrat |

## 1. Conectar los datos

Hay dos caminos. Los dos leen lo mismo que la web pública: nada privado.

### Opción A: importar los CSV (recomendada)

1. Bajá los CSV. O clonás el repositorio (`data/powerbi/`), o los tomás del bucket público, que el
   workflow actualiza cada vez que corre el pipeline:
   `https://ymnbuywcpkynikudybth.supabase.co/storage/v1/object/public/exports/powerbi/<tabla>.csv`
   (por ejemplo `dim_player.csv`). Con la URL podés usar **Obtener datos → Web** y Power BI vuelve a
   bajarlos al tocar Actualizar.
2. Power BI Desktop → **Obtener datos → Texto o CSV** → elegí cada archivo. Origen del archivo:
   **65001: Unicode (UTF-8)**; delimitador: coma.
3. En **Transformar datos**, revisá los tipos: `fecha` como Fecha; `valor`, `valor_90`, `percentil`,
   `xg`, `x`, `y` y los de `fact_projection` como Número decimal; `estimada`, `por90`, `clave`,
   `mas_es_mejor`, `es_arquero`, `boca_shot` y `penalty` como Número entero (0 o 1). Si tu Windows
   usa coma decimal, en **Cambiar tipo → Usando configuración regional** elegí *Inglés (Estados
   Unidos)*.

### Opción B: PostgreSQL directo a Supabase

Sirve para tener los datos al día sin bajar archivos. Usa el rol `powerbi_reader`, que solo puede
leer las vistas del esquema `api` (las mismas que la web): sin escritura, sin `ingest`, sin storage.

1. **Una sola vez, el dueño** le pone contraseña en el SQL Editor de Supabase (generá una larga, por
   ejemplo con un gestor de contraseñas, y no la guardes en el repositorio):

   ```sql
   alter role powerbi_reader with login password '<contraseña larga generada>';
   ```

   Para revocarlo: `alter role powerbi_reader nologin;`.
2. En el panel de Supabase → **Connect** → **Session pooler** copiá el host (algo como
   `aws-0-<región>.pooler.supabase.com`). Puerto **5432** (modo sesión, no el 6543 de transacciones).
3. Power BI → **Obtener datos → Base de datos PostgreSQL**. Servidor `<host>:5432`, base `postgres`,
   modo **Importar**. Credenciales de **Base de datos**: usuario `powerbi_reader.ymnbuywcpkynikudybth`
   y la contraseña del paso 1. Cifrado: activado.
4. Elegí las vistas de `api` que necesites (`player_master`, `team_match_master`, `stat_catalog`,
   `situational_result`, `stat_match_value`, `player_match_value`, `boca_shot`, `chart_catalog`,
   `chart_source_map`, `stat_value_detail`). Ojo: por esta vía los datos llegan como en la base (la
   tabla maestra trae las estadísticas en una columna JSON); el formato largo, los percentiles y la
   media móvil de los CSV los arma `pipeline/powerbi.py`. Para seguir esta guía tal cual, usá la
   opción A.

**Nunca uses la service role key en Power BI** (ni en ningún archivo `.pbix` que compartas): salta
todas las reglas de seguridad de la base.

El rol tiene `statement_timeout` de 60 segundos, transacciones de solo lectura y como mucho 5
conexiones a la vez.

### Actualización

Es manual: botón **Actualizar** de Power BI Desktop. La actualización programada exige publicar en
el servicio de Power BI y depende de la licencia: queda fuera del alcance.

## 2. Tema y tipografía

**Vista → Temas → Buscar temas** → `powerbi/theme.json` (o `theme-oscuro.json`, fondo `#222222`).
Trae la paleta de la web en el mismo orden: verde (principal), violeta (secundario, siempre junto al
verde), rojo (solo lo negativo), azul, amarillo y después el resto.

La tipografía es **Montserrat**. Power BI usa las fuentes instaladas en la PC: si no la tenés,
instalala desde Google Fonts (`fonts.google.com/specimen/Montserrat`); si no, Power BI cae en Segoe
UI. Las letras griegas (α, β, λ, Θ) salen con la fuente de respaldo del sistema.

## 3. Relaciones

**Vista de modelo**. Todas de uno a varios, dirección de filtro simple (de la dimensión al hecho),
salvo la indicada:

| Desde (uno) | Hacia (varios) |
|---|---|
| `dim_player[player_id]` | `fact_player_stat`, `fact_player_minutes`, `fact_player_match_value`, `fact_shot`, `fact_projection` (uno a uno) |
| `dim_stat[stat_id]` | `fact_player_stat`, `stat_distribution`, `fact_stat_match_value` |
| `dim_stat[stat_id]` | `dim_stat_set[stat_id]`, con dirección **Ambas** (así el segmentador de conjunto filtra las estadísticas) |
| `dim_competition[competition_code]` | `fact_player_stat`, `fact_player_minutes`, `fact_match` |
| `dim_date[fecha]` | `fact_match[fecha]` |
| `dim_team[rival]` | `fact_match[rival]` |
| `fact_match[match_id]` | `fact_team_match_stat`, `fact_player_match_value`, `fact_stat_match_value`, `fact_shot` |
| `dim_chart[chart_id]` | `chart_source_map[chart_id]` |

Sin relación (a propósito): `stat_correlation` (filtrala por `stat_a` y `stat_b`), `fact_situational`,
las tablas de ejes `Eje X` y `Eje Y` y los parámetros `A_pico`, `G` y `λ`.

`fact_stat_match_value[entity_id]` es un jugador si `entidad = "player"` y el equipo si
`entidad = "team"`: la medida `Valor por partido del jugador` lo resuelve con `TREATAS`.

Marcá `dim_date` como tabla de fechas (**Herramientas de tabla → Marcar como tabla de fechas**).

## 4. Medidas y parámetros

1. **Modelado → Nueva tabla** para cada tabla calculada del principio de `powerbi/measures.dax`
   (`A_pico`, `G`, `λ`, `Eje X`, `Eje Y`). En `A_pico`, `G` y `λ` renombrá la columna `Value` como
   dice el comentario. También podés crearlos con **Modelado → Nuevo parámetro → Rango numérico**,
   con los mismos rangos y valores por defecto (27, 1,5 y 0,5).
2. **Modelado → Nueva medida** para cada medida. Conviene crear una tabla vacía `Medidas` y colgarlas
   ahí. Formato sugerido: percentiles e índices con 1 decimal.
3. Segmentadores globales (sincronizalos en todas las páginas con **Vista → Sincronizar
   segmentadores**): `dim_competition[nombre]` (selección única, por defecto «Todas las
   competiciones») y, donde haga falta, `dim_stat[nombre]` y `dim_stat_set[conjunto]`.

Para elegir la estadística de un gráfico hay dos formas: el segmentador sobre `dim_stat` con la
medida `Valor seleccionado` (lo que usa esta guía), o **parámetros de campo** (Modelado → Nuevo
parámetro → Campos), que en versiones viejas de Power BI Desktop hay que activar en Opciones →
Características de vista previa.

Las medias de referencia (`Media del plantel (sin el jugador)`, `Media de su línea (sin el
jugador)`) excluyen al jugador comparado con `REMOVEFILTERS` y piden 450 minutos, como la web.
`Media de la línea filtrada` usa `ALLEXCEPT` y sí incluye a todos.

## 5. Las páginas

### 5.1 Tabla maestra

- **Matriz**: filas `dim_player[nombre]`; columnas `dim_stat[abrev]`; valores `Valor seleccionado`.
  Segmentadores: competición, `dim_stat_set[conjunto]`, `dim_player[linea]`. Formato condicional del
  valor por `Percentil seleccionado` (escala verde del tema).
- Información sobre herramientas: `Descripción de la estadística`, `Aviso de estimación`.
- Clic derecho en un jugador → **Obtener detalles → Estadística desglosada** (drill-through, 5.7).

### 5.2 Comparador

- Segmentador de jugador (`dim_player[nombre]`, selección múltiple) y de conjunto.
- **Radar** (gráfico 1): visual personalizado de AppSource (**Obtener más objetos visuales** →
  buscá «Radar Chart», el de Microsoft). Categoría `dim_stat[abrev]`, valor `Percentil
  seleccionado`, leyenda `dim_player[nombre]`. Verificá que funcione en tu versión; si falla, usá
  **barras agrupadas** con los mismos campos.
- **Matriz lado a lado**: filas `dim_stat[nombre]`, columnas `dim_player[nombre]`, valores `Valor
  seleccionado` y `Percentil seleccionado`.
- Tarjetas con `Jugador actual`, `Diferencia con el plantel` y `Diferencia con su línea`.

### 5.3 Equipo y partidos

- **Forma del equipo** (gráfico 6): gráfico combinado con eje `fact_match[fecha]`, columnas `Puntos`
  coloreadas con formato condicional por `Color por resultado` (valor de campo) y línea `Puntos
  acumulados`.
- **Tabla de partidos**: `fecha`, `rival`, `local`, `goles_favor`, `goles_contra`, `resultado`.
- Goles por tramo (7), xG por partido (8), puntos reales frente a esperados (9) y minutos por
  partido (12): ver el cuadro de la sección 6.

### 5.4 Exploración

- **Dispersión configurable** (gráfico 2): segmentadores `Eje X[nombre]` y `Eje Y[nombre]`
  (selección única); dispersión con X `Valor eje X`, Y `Valor eje Y`, detalles
  `dim_player[nombre]`, tamaño `Minutos`, leyenda `dim_player[linea]`. Panel **Análisis** → línea de
  mediana en los dos ejes.
- **Ranking** (3), **distribución** (4), **mapa de tiros** (11) y **matriz de correlación** (14).

### 5.5 Situaciones

- Segmentadores `fact_situational[categoria]` y `fact_situational[tarjeta]`.
- Barras: eje `fact_situational[fila]`, valor `% de victorias en la situación`; información sobre
  herramientas con `Partidos en la situación` y `Diferencia con la base` (positiva en verde,
  negativa en rojo).
- Tabla con `partidos`, `ganados`, `empatados`, `perdidos`, `puntos_por_partido`, `gf`, `gc`. Con
  menos de 5 partidos en una fila, leela como orientativa (la web lo avisa igual).

### 5.6 Comparación directa

- Un segmentador de jugador de selección múltiple limitado a dos, o dos independientes (creá
  `Jugador B = dim_player` con **Nueva tabla** y relacionala igual que `dim_player`, inactiva, para
  usarla con `USERELATIONSHIP`).
- **Barras divergentes**: eje `dim_stat[nombre]`, valor `Diferencia con el plantel`, color por
  `Color por signo` (verde a favor, rojo en contra).
- Tarjetas de `Mejoría α`, `Potencial α` y `Potencial β` de cada uno, con `Aviso 6.1` debajo.

### 5.7 Estadística desglosada (drill-through)

- En **Campos de obtención de detalles** poné `dim_player[nombre]` y `dim_stat[nombre]`. Activá
  **Mantener todos los filtros**.
- **Evolución por fecha** (gráfico 5): líneas con eje `fact_match[fecha]`, valores `Valor por
  partido del jugador` y la media móvil de 5 partidos (`fact_stat_match_value[rolling_5]`,
  promedio).
- Tabla partido por partido: `fact_match[fecha]`, `rival`, `fact_stat_match_value[valor]`,
  `minimo`, `maximo`.
- Botón **Atrás** (Insertar → Botones → Atrás) para volver a la página de origen.

### 5.8 Evolución y proyección (6.1)

- Segmentadores de los parámetros `A_pico`, `G` y `λ` (sobre la columna de cada parámetro, estilo
  **Único valor** con control deslizante).
- **Tabla**: `dim_player[nombre]`, `fact_projection[edad]`, `Minutos`, `Índice de rendimiento`,
  `Cobertura del índice`, `Mejoría α`, `Mejoría β`, `Potencial α`, `Potencial α mínimo`, `Potencial
  α máximo`, `Potencial β`.
- **Gráfico de bala del Potencial α**: barras horizontales con `Potencial α` y barras de error (panel
  Análisis → Barras de error) de `Potencial α mínimo` a `Potencial α máximo`.
- `Potencial α` se recalcula con los parámetros; `Potencial α (pipeline)` es el valor de la web con
  los valores por defecto. Con `A_pico = 27`, `G = 1,5` y `λ = 0,5` los dos coinciden.
- `fact_projection[nivel_n]` es el nivel N de 6.1.4. Si un jugador llega al tope (Potencial α =
  100), N no se puede despejar y queda en blanco hasta que el pipeline publique el detalle.
- Siempre visible: tarjeta con `Aviso 6.1`. Son estimaciones, no predicciones.

### Botones «Ver origen» (9.9)

`dim_chart` lista los 103 gráficos del catálogo y `chart_source_map` a dónde lleva cada uno. En cada
visual que tenga origen, agregá un botón (Insertar → Botones → En blanco) con texto `Texto del botón
origen` y acción **Navegación de página** hacia la página del destino (`destino_tipo = desglosada` →
5.7; `tabla` → la página de esa tabla). Filtrá el botón por su `chart_id` (por ejemplo `g01` para la
forma del equipo). Si el gráfico no tiene filas en `chart_source_map`, `Tiene origen` da 0 y el
botón no se muestra: no lleva a ningún lado y no pasa nada.

## 6. Gráfico por gráfico (cuadro 9.4)

| # | Gráfico | Visual de Power BI | Campos | Medidas | Segmentadores |
|---|---|---|---|---|---|
| 1 | Comparador de jugadores | Radar de AppSource; si no anda, barras agrupadas. Matriz lado a lado | `dim_stat[abrev]`, `dim_player[nombre]` | `Percentil seleccionado`, `Valor seleccionado` | Jugador (varios), conjunto, competición |
| 2 | Dispersión configurable | Dispersión con línea de mediana (Análisis) | `dim_player[nombre]` (detalles), `dim_player[linea]` (leyenda) | `Valor eje X`, `Valor eje Y`, `Minutos` (tamaño) | `Eje X[nombre]`, `Eje Y[nombre]`, competición |
| 3 | Ranking | Barras horizontales con filtro **N superiores** (10) por `Valor seleccionado` | `dim_player[nombre]` | `Valor seleccionado`, `Puesto` | Estadística (`dim_stat[nombre]`), competición |
| 4 | Distribución | Columnas (caja y bigotes solo con visual personalizado, opcional) | `stat_distribution[intervalo]`, `desde`, `hasta` | `Jugadores en el intervalo` | Estadística |
| 5 | Evolución por fecha | Líneas | `fact_match[fecha]` | `Valor por partido del jugador`, `fact_stat_match_value[rolling_5]` | Jugador, estadística |
| 6 | Forma del equipo | Columnas coloreadas por resultado + línea (gráfico combinado) | `fact_match[fecha]` | `Puntos` (color: `Color por resultado`), `Puntos acumulados` | Competición |
| 7 | Goles por tramo de minutos | Columnas agrupadas | `fact_team_match_stat[clave]` filtrada a `goals_for_00_15` … `goals_for_76_90` y sus `goals_against_*` | `Valor del equipo` (como suma) | Competición |
| 8 | xG a favor y en contra por partido | Líneas o columnas agrupadas | `fact_match[fecha]`; `fact_team_match_stat[clave]` = `xg` y `xg_against` (leyenda) | `Valor del equipo` | Competición |
| 9 | Puntos reales frente a esperados | Dispersión con línea de referencia (Análisis → línea constante o de tendencia) | `fact_match[match_id]` (detalles); X: `Valor del equipo` con `clave = eq_xpts` | `Puntos` (Y) | Competición |
| 10 | Evolución de la tabla | Líneas con el eje Y invertido | — | — | **No disponible**: las fuentes solo dan la tabla final de cada torneo, no las posiciones fecha a fecha (igual que en la web) |
| 11 | Mapa de tiros | Dispersión con la imagen de la cancha como fondo del área de trazado (Formato → Área de trazado → Imagen; ejes de 0 a 1, ocultos) | `fact_shot[x]`, `fact_shot[y]`, `player_name` (detalles), `outcome` (leyenda) | `fact_shot[xg]` (tamaño) | Jugador, partido, `boca_shot` (1 = a favor) |
| 12 | Minutos por partido | Columnas apiladas + línea de carga | `fact_match[fecha]`, `dim_player[nombre]` (leyenda), `fact_player_match_value[clave] = minutes` | `fact_player_match_value[valor]` (suma) | Jugador, competición |
| 13 | Métricas propias | Barras con formato condicional por signo | `dim_player[nombre]` | `NR`, `EWA`, `ELA`; color `Color por signo` | Competición |
| 14 | Matriz de correlación | Matriz con escala de color (formato condicional) | `stat_correlation[stat_a]` (filas), `stat_b` (columnas) | `Correlación` | — |

Los demás gráficos del catálogo están en `dim_chart` con su columna `powerbi` (`sí`, `alternativa`
o `no`) y el motivo en `motivo`: la mayoría son variantes de estos 14 con otra estadística o
categoría y se arman igual, cambiando el segmentador.

## 7. Notas

- Los porcentajes de los CSV vienen de 0 a 100 (como en la web), no de 0 a 1: no les apliques el
  formato porcentaje de Power BI sin dividir por 100.
- Las estadísticas con `estimada = 1` son aproximaciones del pipeline: mostrá `Aviso de estimación`
  en la información sobre herramientas.
- **Publicar en la web** (incrustar el reporte en el sitio) exige una licencia que lo permita y que
  un administrador habilite la opción; en cuentas personales suele no estar disponible. Por eso la
  web usa sus propios gráficos y Power BI queda como complemento local.
