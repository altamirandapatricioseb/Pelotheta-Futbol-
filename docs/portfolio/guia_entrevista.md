# Guía de entrevista

30 preguntas probables, con la respuesta corta y dónde verlo en el repositorio.

| # | Pregunta | Respuesta corta | Dónde |
|---|---|---|---|
| 1 | ¿Qué problema resuelve? | Junta la temporada de Boca y explica cada número: fuente, nivel A/B/C y partidos. | `README.md` |
| 2 | ¿Por qué Next.js y no Streamlit? | Streamlit necesita un servidor encendido; Next.js en Vercel es gratis y serverless. | `docs/adr/0005-nextjs-frente-a-streamlit.md` |
| 3 | ¿Cómo protegés la base si la clave es pública? | RLS: el rol anónimo solo lee vistas; pgTAP verifica que no puede escribir. | `supabase/tests/database/security.test.sql` |
| 4 | ¿Por qué publicar la clave publicable? | Es pública por diseño; la seguridad la da RLS, no el secreto. | `docs/adr/0007-clave-publicable-publica.md` |
| 5 | ¿Qué es el nivel A, B o C? | A viene de una fuente, B lo calcula el sistema, C no tiene dato. | `docs/catalogo_estadisticas.md` |
| 6 | ¿Por qué calcular en el pipeline? | Las fuentes gratuitas son frágiles; calcular reduce los n/d cuando una cae. | `docs/adr/0002-calculo-en-pipeline.md` |
| 7 | ¿Cómo evitás duplicar al recargar? | Upserts idempotentes por id de la fuente principal. | `pipeline/` |
| 8 | ¿Cómo validás los datos? | Pydantic al entrar y 16 chequeos SQL al terminar la carga. | `sql/quality/checks.sql` |
| 9 | ¿Por qué la calidad en SQL? | Corre donde están los datos y la misma consulta alimenta `/estado`. | `docs/adr/0009-calidad-de-datos-en-sql.md` |
| 10 | Un bug que encontraste con tus chequeos | La conciliación sumaba los penales de la definición; se excluyen. | `docs/pruebas/plan_de_pruebas.md` |
| 11 | ¿Cómo calibraste el Elo? | Grilla de K y localía minimizando log-loss sin datos futuros. | `notebooks/02_calibracion.ipynb` |
| 12 | ¿Validaste el Elo? | Sí, contra resultados posteriores, con su ficha de modelo. | `docs/model_cards/elo.md` |
| 13 | ¿Tu modelo predictivo es bueno? | No le gana al Elo calibrado, así que no se publica. | `docs/model_cards/resultado_partido.md` |
| 14 | ¿La Mejoría predice? | No: describe el pasado reciente (regresión a la media). | `notebooks/04_mejoria_potencial.ipynb` |
| 15 | ¿Por qué dos variantes, α y β? | Para comparar supuestos distintos y mostrar la sensibilidad. | `docs/adr/0006-variantes-alfa-y-beta.md` |
| 16 | ¿Qué es el pitagórico y los xPts? | Puntos esperados por goles y xG, contra los puntos reales. | `docs/model_cards/pitagorico_xpts.md` |
| 17 | ¿Qué hace la CSP con nonce? | Solo corren scripts firmados por request; corta XSS por inyección. | `docs/adr/0003-csp-con-nonce.md` |
| 18 | ¿Qué pasó con ELNINE? | Cloudflare bloquea clientes automáticos; no se evade. | `docs/adr/0008-no-evadir-protecciones-de-fuentes.md` |
| 19 | ¿Cómo medís la accesibilidad? | axe con Playwright en 14 rutas, dos temas y dos dispositivos. | `web/e2e/a11y.spec.ts` |
| 20 | ¿Cómo probás la UI sin que los datos rompan capturas? | Regresión visual con los datos tapados y tolerancia. | `web/e2e/visual.spec.ts` |
| 21 | ¿Qué SLOs tenés? | Disponibilidad, frescura de datos, carga mensual y tamaño de base. | `docs/slo.md` |
| 22 | ¿Qué hacés si se filtra la clave secreta? | Rotar, actualizar secretos y revisar accesos, según el playbook. | `docs/security/incident_response.md` |
| 23 | ¿Cómo restaurás el sistema? | Migraciones más pipeline, o el backup cifrado. | `docs/recuperacion.md` |
| 24 | ¿Qué modelo de amenazas hiciste? | STRIDE sobre el flujo de datos. | `docs/security/threat_model.md` |
| 25 | ¿Cómo está organizada la base? | `core` privado con RLS y vistas `api` con security_invoker. | `docs/diagramas/der.md` |
| 26 | ¿Cómo hiciste el Excel interactivo? | xlsxwriter con validación de datos y fórmulas que alimentan gráficos nativos. | `pipeline/excel.py` |
| 27 | ¿Cómo armaste Power BI? | CSV en estrella con dimensiones, hechos y medidas DAX. | `docs/powerbi_guia.md` |
| 28 | ¿Qué cobertura tenés? | Pipeline 89 % y web 93 %, con mínimos en CI. | `docs/pruebas/estrategia.md` |
| 29 | ¿Cómo trabajaste el proyecto? | Etapas con Definición de Terminado y verificación en producción. | `docs/gestion/README.md` |
| 30 | ¿Qué sigue? | Reemplazar StrikerAPI, landing en el servidor y validar el Potencial con 2027. | `docs/gestion/informe_cierre.md` |
