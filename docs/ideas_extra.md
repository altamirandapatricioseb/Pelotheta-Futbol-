# Ideas extra y extras justificados

Lo agregado por iniciativa propia, lo que se propone y no se hizo, y los extras de la sección 16 que no se
implementaron tal cual pide el prompt, con el motivo.

## Agregado por iniciativa propia

| Qué | Por qué |
|---|---|
| Página `/estado` con SLOs, corridas, calidad de datos y cobertura del catálogo | Un solo lugar para saber si el sitio y los datos están bien, sin abrir paneles |
| Página `/soporte` con los códigos de error | El repositorio es privado: los artículos en GitHub no eran visibles para terceros |
| Animación del cambio de tema (círculo desde el botón) | Pedido del dueño; respeta «reducir movimiento» |
| Fuente ELNINE (DT de cada equipo y capacidad del estadio) | Pedido del dueño; hoy bloqueada por Cloudflare y lista para cuando deje de estarlo |
| Calibración del Elo (K = 30, V = 50) aplicada en `projection_param` | La validación del notebook 02 mostró que el arranque sobreestimaba la localía |
| Conciliación de goles sin la definición por penales | Un chequeo de calidad encontró 2 partidos con los penales de la definición sumados como goles |

## Estadísticas y gráficos propuestos (no implementados)

| # | Idea | Depende de | Por qué no está |
|---|---|---|---|
| 1 | Rendimiento según el DT rival | ELNINE (DT por partido) | La fuente está bloqueada |
| 2 | Puntos según la capacidad del estadio visitante | ELNINE (capacidad) | La fuente está bloqueada |
| 3 | xG móvil de cada equipo de la liga | xG de todos los partidos de la liga | Ninguna fuente con permiso cubre toda la liga |
| 4 | Probabilidad pre-partido del próximo partido de Boca | Elo calibrado y fixture | El modelo no le gana al Elo; con el Elo solo es un aporte menor y queda para 2027 |
| 5 | Gráfico de calibración del Elo en la web | Notebook 03 | Está en `docs/notebooks/`; en la web sería un gráfico más sin pregunta de hincha detrás |
| 6 | Mejoría α como pronóstico | Notebook 04 | La validación mostró que no anticipa (regresión a la media): no se debe presentar como pronóstico |
| 7 | Comparación de Potencial α entre temporadas | Dos temporadas por jugador | Hay una sola temporada |
| 8 | Duelos por zona de la cancha | Eventos con coordenadas de todos los duelos | Las fuentes con permiso solo dan coordenadas de remates |
| 9 | Presión tras pérdida (recuperaciones en 5 s) | Eventos con marca de tiempo por acción | No hay datos de eventos completos con permiso |
| 10 | Mapa de pases | Eventos de pase con coordenadas | Ídem |

## Extras de la sección 16 no implementados tal cual

| Extra | Qué pedía | Qué se hizo y por qué |
|---|---|---|
| 16.1 Capas `raw` → `staging` → `marts` como esquemas | Tres esquemas en Postgres | Los datos crudos quedan en `data/raw` (caché de las fuentes, fuera de la base por el límite de 500 MB); `core` es la capa limpia y `api`, los marts. Contratos y chequeos sí, en `data/contracts.yml` y `sql/quality/` |
| 16.1 `pandera` | Validación de tablas en Python | Los registros se validan al entrar con Pydantic (`pipeline/models.py`) y las tablas con los chequeos SQL; `pandera` duplicaría eso |
| 16.4 Modelo en la web | Publicar si le gana al Elo | No le gana al Elo calibrado: documentado en `docs/model_cards/resultado_partido.md` |
| 16.7 Mutation testing | Opcional | No aplicado; primer candidato `mutmut` sobre `pipeline/metrics.py` |
| 16.7 k6 contra el preview | Prueba de carga | Script listo (`k6/carga.js`); no corrido: k6 no está instalado y el preview está protegido |
| 16.9 GitHub Projects | Tablero con issues y milestones | Repositorio privado y de una persona: ver `docs/gestion/README.md` |
| 16.10 Dominio propio | Opcional | Sin dominio: `docs/red/dominio.md` explica el recorrido actual y los pasos si se compra |
