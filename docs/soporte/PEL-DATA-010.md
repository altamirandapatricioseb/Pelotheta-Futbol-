# PEL-DATA-010: Dato fuera de rango

**Qué es.** Un valor de una fuente no pasó la validación (rango, tipo o clave) y quedó en cuarentena (`data/quarantine/`).

**Qué ve quien usa el sitio.** El aviso «PEL-DATA-010: …» con un enlace a este artículo. El resto del sitio sigue funcionando.

## Causas habituales

- La fuente publicó un valor erróneo (por ejemplo, posesión de 140 %).
- Cambio de unidad o de formato en la fuente.

## Cómo se resuelve

1. Revisar el archivo de cuarentena de la corrida.
2. Si el valor es correcto y la regla es demasiado estricta, ajustar la regla con su prueba.
3. Si es un error de la fuente, dejarlo en cuarentena y anotarlo en el issue.

## Severidad sugerida

Baja si es un dato aislado; media si se repite en varias corridas.
