# Caso de estudio: Pelotheta Θ

## Situación

Los datos de Boca Juniors están repartidos en sitios que muestran el último partido o la tabla, sin historia
ni confiabilidad declarada, y las herramientas de análisis serias son pagas o privadas.

## Tarea

Construir, solo y con planes gratuitos, un sistema que junte la temporada, la explique y la deje auditar: web
pública, libros de Excel, modelo de Power BI y una API, con seguridad y calidad de nivel profesional.

## Acción

- **Datos:** pipeline en Python que lee 9 fuentes respetando robots.txt y sin evadir protecciones, valida con
  Pydantic, carga con upserts idempotentes y calcula todo lo calculable (175 estadísticas nivel B).
- **Base:** Postgres con RLS: tablas privadas y vistas públicas de solo lectura, verificadas con pgTAP.
- **Web:** Next.js 16 con 5 interfaces, 103 gráficos, doble clic a la estadística desglosada, CSP con nonce y
  accesibilidad verificada con axe.
- **Análisis:** métricas propias con dos variantes, validadas en notebooks; el Elo se recalibró y un modelo
  predictivo que no superaba al Elo no se publicó.
- **Operación:** SLOs, métricas por corrida, 16 chequeos de calidad, backup cifrado con restauración probada y
  documentación completa.

## Resultado

- Sitio en producción con 100 de 103 gráficos y 123 de 132 tarjetas con datos reales.
- 558 pruebas automatizadas sin fallas; cobertura de 89 % y 93 %; 0 violaciones de accesibilidad.
- Base de 40 MB de 500.
- Hallazgos reales gracias a la validación: penales de la definición contados como goles, localía del Elo
  sobreestimada, una métrica que describía en vez de anticipar.

## Aprendizajes

- Medir antes de optimizar: Lighthouse, cobertura y calibración evitaron trabajo inútil.
- Verificar los supuestos de plataforma (el repositorio era privado) antes de diseñar sobre ellos.
- Publicar con honestidad lo que no funcionó vale tanto como lo que funcionó.
