# ADR 0008: no evadir protecciones de las fuentes

- Estado: aceptada (2-nov-2026)

## Contexto
ELNINE permite rastrear en su robots.txt, pero Cloudflare desafía al cliente HTTP del pipeline. Imitar la
huella de un navegador o de curl lo haría pasar.

## Decisión
El pipeline se identifica siempre (`PelothetaBot` con el enlace del repositorio), respeta robots.txt y las
pausas, y nunca evade desafíos, CAPTCHAs ni bloqueos. Si una fuente bloquea, se registra como aviso y la
corrida sigue sin ella (`sources/elnine.py`, `check_challenge`).

## Consecuencias
- Datos de ELNINE (DT y capacidad) en `n/d` mientras dure el bloqueo; el adaptador se activa solo si cambia.
