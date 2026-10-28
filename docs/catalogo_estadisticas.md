# Catálogo de estadísticas

Generado desde `data/stat_catalog.csv` con `uv run python -m scripts.catalog_doc`.
El CSV es la fuente de verdad: la web y las vistas SQL leen de él la descripción, el nivel
y la regla de cálculo.

| Entidad | Nivel A | Nivel B | Nivel C | Total |
|---|---|---|---|---|
| jugador | 77 | 75 | 8 | 160 |
| equipo | 80 | 100 | 4 | 184 |

Niveles: **A** viene directo de una fuente; **B** se calcula (por 90, porcentajes, rachas,
métricas propias); **C** no tiene fuente gratuita fiable y se muestra `n/d`.

## Nivel A: ¿se puede calcular desde datos más básicos?

| Estadística | Fuente | Reemplazo por cálculo |
|---|---|---|
| Partidos como capitán (`capitan`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Calificación media (`calificacion`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Altura (`altura`) | promiedos | No: dato de la ficha. |
| Peso (`peso`) | wikipedia | No: dato de la ficha. |
| Pie hábil (`pie`) | bzzoiro | No: dato de la ficha. |
| Nacionalidad (`nacionalidad`) | wikipedia | No: dato de la ficha. |
| Posición (`posicion`) | promiedos | No: dato del plantel. |
| Goles de cabeza (`goles_cabeza`) | strikerapi | Sí, desde los tiros ubicados (parte del cuerpo); es lo que hace la vista por partido. |
| Goles desde fuera del área (`goles_fuera_area`) | strikerapi | Sí, desde los tiros ubicados (zona); es lo que hace la vista por partido. |
| Remates (`remates`) | scoutingstats | Parcial: contar los tiros ubicados de StrikerAPI (solo liga); los tiros validan a la fuente. |
| Remates al arco (`remates_arco`) | scoutingstats | Parcial: tiros ubicados con resultado gol o atajado (solo liga). |
| Remates bloqueados (`remates_bloqueados`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Remates de cabeza (`remates_cabeza`) | strikerapi | Sí, desde los tiros ubicados. |
| Remates desde fuera del área (`remates_fuera_area`) | strikerapi | Sí, desde los tiros ubicados. |
| Goles esperados (`xg`) | scoutingstats, statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| xG al arco (`xgot`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Ocasiones claras falladas (`ocasiones_claras_falladas`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Remates al palo (`remates_palo`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Fueras de juego (`fueras_de_juego`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Faltas recibidas (`faltas_recibidas`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Penales provocados (`penales_provocados`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Regates exitosos (`regates_exitosos`) | scoutingstats, statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Regates intentados (`regates_intentados`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Toques (`toques`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pases intentados (`pases`) | scoutingstats, statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pases completados (`pases_completos`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pases clave (`pases_clave`) | scoutingstats, statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Ocasiones claras creadas (`ocasiones_claras_creadas`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Ocasiones creadas (`ocasiones_creadas`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Asistencias esperadas (`xa`) | statshub, bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pases largos (`pases_largos`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pases largos completados (`pases_largos_completos`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Centros (`centros`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Centros completados (`centros_completos`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pases en campo rival (`pases_campo_rival`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pases completados en campo rival (`pases_campo_rival_completos`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pérdidas de posesión (`perdidas`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Desposesiones (`desposesiones`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Malos controles (`malos_controles`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Conducciones (`conducciones`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Conducciones progresivas (`conducciones_progresivas`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Metros en conducción (`distancia_conduccion`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Metros de progresión (`progresion`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Asistencias de centro (`asistencias_centro`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Asistencias con pase filtrado (`asistencias_filtrado`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Asistencias de cabeza (`asistencias_cabeza`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Asistencias con pase común (`asistencias_pase`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Entradas (`entradas`) | scoutingstats, statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Entradas intentadas (`entradas_intentadas`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Entradas ganadas (`entradas_ganadas`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Intercepciones (`intercepciones`) | scoutingstats, statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Despejes (`despejes`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Despejes sobre la línea (`despejes_linea`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Bloqueos (`bloqueos`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Recuperaciones (`recuperaciones`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Duelos ganados (`duelos_ganados`) | scoutingstats, statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Duelos perdidos (`duelos_perdidos`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Duelos aéreos ganados (`aereos_ganados`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Duelos aéreos perdidos (`aereos_perdidos`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Veces regateado (`veces_regateado`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Entradas de último hombre (`entradas_ultimo_hombre`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Errores que terminan en remate (`errores_remate`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Errores que terminan en gol (`errores_gol`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Faltas cometidas (`faltas_cometidas`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Atajadas (`atajadas`) | strikerapi, scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Remates al arco recibidos (`remates_arco_recibidos`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| xG al arco recibido (`xgot_recibido`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Penales enfrentados (`penales_enfrentados`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Penales atajados (`penales_atajados`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Centros atrapados (`centros_atrapados`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Despejes de puños (`despejes_punos`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Salidas (`salidas`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Salidas exitosas (`salidas_exitosas`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Atajadas de remates en el área (`atajadas_dentro_area`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Penales cometidos (`penales_cometidos`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Manos sancionadas (`manos`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Partidos por suspensión (`partidos_suspendido`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles de cabeza (`eq_goles_cabeza`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles desde fuera del área (`eq_goles_fuera_area`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles desde el área chica (`eq_goles_area_chica`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles de penal (`eq_goles_penal`) | strikerapi | Sí, desde los eventos de penal convertido de Promiedos (todas las competiciones). |
| Goles de tiro libre (`eq_goles_tiro_libre`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles de córner (`eq_goles_corner`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles de pelota parada (`eq_goles_pelota_parada`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles de contraataque (`eq_goles_contraataque`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles después de un centro (`eq_goles_centro`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles de pie izquierdo (`eq_goles_pie_izquierdo`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles de pie derecho (`eq_goles_pie_derecho`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles de cabeza en contra (`eq_goles_cabeza_contra`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles en contra desde fuera del área (`eq_goles_fuera_area_contra`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles de pelota parada en contra (`eq_goles_pelota_parada_contra`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles de contraataque en contra (`eq_goles_contraataque_contra`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Remates (`eq_remates`) | promiedos | Parcial: suma de los remates de los jugadores (ScoutingStats); valida al de Promiedos. |
| Remates al arco (`eq_remates_arco`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Remates desviados (`eq_remates_afuera`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Remates bloqueados (`eq_remates_bloqueados`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Remates dentro del área (`eq_remates_dentro_area`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Remates fuera del área (`eq_remates_fuera_area`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Ocasiones claras (`eq_ocasiones_claras`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Ocasiones claras falladas (`eq_ocasiones_claras_falladas`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Ocasiones claras concedidas (`eq_ocasiones_claras_contra`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Ataques (`eq_ataques`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Ataques peligrosos (`eq_ataques_peligrosos`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Centros (`eq_centros`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Centros completados (`eq_centros_completos`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Regates intentados (`eq_regates`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Regates exitosos (`eq_regates_exitosos`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pases clave (`eq_pases_clave`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Fueras de juego (`eq_fueras_juego`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Remates del rival (`eq_remates_contra`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Remates al arco del rival (`eq_remates_arco_contra`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles esperados (`eq_xg`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Goles esperados en contra (`eq_xg_contra`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| xG sin penales (`eq_npxg`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| xG sin penales en contra (`eq_npxg_contra`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| xG de jugada (`eq_xg_jugada`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| xG de pelota parada (`eq_xg_pelota_parada`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| xG de pelota parada en contra (`eq_xg_pelota_parada_contra`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| xG al arco (`eq_xgot`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| xG al arco en contra (`eq_xgot_contra`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Puntos esperados de la fuente (`eq_xpts_fuente`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Posesión (`eq_posesion`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pases intentados (`eq_pases`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pases completados (`eq_pases_completos`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pases largos (`eq_pases_largos`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pases largos completados (`eq_pases_largos_completos`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pases del rival (`eq_pases_contra`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Pérdidas de posesión (`eq_perdidas`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Recuperaciones (`eq_recuperaciones`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Conducciones (`eq_conducciones`) | bzzoiro | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Entradas (`eq_entradas`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Entradas ganadas (`eq_entradas_ganadas`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Intercepciones (`eq_intercepciones`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Despejes (`eq_despejes`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Duelos ganados (`eq_duelos_ganados`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Duelos aéreos ganados (`eq_aereos_ganados`) | statshub | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Bloqueos (`eq_bloqueos`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Atajadas (`eq_atajadas`) | scoutingstats | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Faltas cometidas (`eq_faltas`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Faltas recibidas (`eq_faltas_recibidas`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Córners a favor (`eq_corners`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Córners en contra (`eq_corners_contra`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Tiros libres a favor (`eq_tiros_libres`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Penales a favor (`eq_penales_favor`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Penales convertidos (`eq_penales_convertidos`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Penales en contra (`eq_penales_contra`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Penales convertidos en contra (`eq_penales_convertidos_contra`) | strikerapi | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Tarjetas amarillas (`eq_amarillas`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Expulsiones (`eq_rojas`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Amarillas del rival (`eq_amarillas_rival`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Expulsiones del rival (`eq_rojas_rival`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Árbitro (`eq_arbitro`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Estadio (`eq_estadio`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Temperatura (`eq_temperatura`) | openmeteo | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Lluvia (`eq_lluvia`) | openmeteo | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Bajas del rival (`eq_bajas_rival`) | promiedos | No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo. |
| Posición en la tabla (`eq_posicion`) | promiedos | Sí, desde los resultados de toda la liga; la fuente queda como validación. |

## Nivel C (n/d)

| Estadística | Motivo |
|---|---|
| Pases progresivos (`pases_progresivos`) | Pases que avanzan la pelota de forma clara hacia el arco rival. Ninguna fuente permitida los publica. |
| Pases al último tercio (`pases_ultimo_tercio`) | Pases que llegan al último tercio de la cancha. Ninguna fuente permitida los publica. |
| Pases clave de juego abierto (`pases_clave_juego_abierto`) | Pases clave sin contar la pelota parada. Ninguna fuente gratuita separa el tipo de jugada. |
| Presiones (`presiones`) | Presiones sobre un rival con la pelota. Ninguna fuente gratuita permitida las publica. |
| Presiones exitosas (`presiones_exitosas`) | Presiones que terminan en una recuperación en pocos segundos. Sin fuente gratuita. |
| Presiones exitosas (%) (`pct_presiones`) | Porcentaje de presiones que terminan en recuperación. Sin fuente gratuita. |
| Distancia recorrida (`distancia_recorrida`) | Kilómetros recorridos. Ninguna fuente gratuita publica datos de seguimiento de los jugadores. |
| Sprints (`sprints`) | Carreras a máxima velocidad. Ninguna fuente gratuita publica datos de seguimiento. |
| Pases progresivos (`eq_pases_progresivos`) | Pases que avanzan de forma clara hacia el arco rival. Ninguna fuente permitida los publica. |
| Pases al último tercio (`eq_pases_ultimo_tercio`) | Pases que llegan al último tercio de la cancha. Ninguna fuente permitida los publica. |
| Field Tilt (`eq_field_tilt`) | Parte de los pases en el último tercio que son propios. Sin pases por zona queda n/d; ver Dominio. |
| Presiones (`eq_presiones`) | Presiones sobre el rival con la pelota. Ninguna fuente gratuita permitida las publica. |
