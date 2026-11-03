# Gantt (planificado frente a real)

El plan suponía unas 4 a 8 horas por etapa en días seguidos; lo real sale de los commits de cierre de cada
etapa (`git log`). Datos en `gantt.csv`. El hueco del 29 de octubre al 2 de noviembre es una pausa del
proyecto: la etapa 8 cerró su hoja pendiente (Desglosada) el 2 de noviembre.

```mermaid
gantt
    title Pelotheta Θ: planificado frente a real
    dateFormat YYYY-MM-DD HH:mm
    axisFormat %d-%b
    section 1. Base, Fase 0 y seguridad
    Plan :p1, 2026-10-27 08:00, 2026-10-27 12:00
    Real :done, r1, 2026-10-27 08:00, 2026-10-27 11:46
    section 2. Esqueleto y tabla Resumen
    Plan :p2, 2026-10-27 12:00, 2026-10-27 16:00
    Real :done, r2, 2026-10-27 11:46, 2026-10-27 13:00
    section 3. Pipeline mensual y Actualizar
    Plan :p3, 2026-10-27 16:00, 2026-10-27 22:00
    Real :done, r3, 2026-10-27 13:00, 2026-10-27 22:50
    section 4. Catálogo y tablas maestras
    Plan :p4, 2026-10-27 22:00, 2026-10-28 02:00
    Real :done, r4, 2026-10-27 22:50, 2026-10-28 02:27
    section 5. Gráficos (Interfaz 1)
    Plan :p5, 2026-10-28 02:00, 2026-10-28 06:00
    Real :done, r5, 2026-10-28 02:27, 2026-10-28 06:13
    section 6. Situaciones y desglosada
    Plan :p6, 2026-10-28 06:00, 2026-10-28 12:00
    Real :done, r6, 2026-10-28 06:13, 2026-10-28 16:18
    section 7. Comparación directa
    Plan :p7, 2026-10-28 12:00, 2026-10-28 16:00
    Real :done, r7, 2026-10-28 16:18, 2026-10-28 17:44
    section 8. Excel
    Plan :p8, 2026-10-28 16:00, 2026-10-28 22:00
    Real :done, r8, 2026-10-28 17:44, 2026-11-02 12:00
    section 9. Power BI
    Plan :p9, 2026-10-28 22:00, 2026-10-29 06:00
    Real :done, r9, 2026-11-02 08:00, 2026-11-02 12:47
    section 10. Pulido, seguridad y extras
    Plan :p10, 2026-10-29 06:00, 2026-10-30 06:00
    Real :done, r10, 2026-11-02 12:47, 2026-11-02 22:36
    section 11. Documentación y entrega
    Plan :p11, 2026-10-30 06:00, 2026-10-31 06:00
    Real :active, r11, 2026-11-02 22:40, 2026-11-03 06:00
    section Hitos
    Primer deploy :milestone, m1, 2026-10-27 11:46, 0m
    Landing en producción :milestone, m2, 2026-10-28 06:13, 0m
    Libros de Excel :milestone, m3, 2026-10-28 22:43, 0m
    Etapa 10 en producción :milestone, m4, 2026-11-02 22:36, 0m
```

## Dependencias

Cada etapa depende de la anterior salvo 5, 6 y 8, que dependen del catálogo de la etapa 4 (columna
`depende_de` del CSV).

## Desvíos

| Etapa | Desvío | Causa |
|---|---|---|
| 3 | +4 h | Cierre de seguridad 14.9 y keepalive dos veces por semana |
| 6 | +4 h | Más conclusiones y tarjetas que las pedidas |
| 8 a 11 | +4 días | Pausa entre el 29-oct y el 2-nov |
| 10 | +4 h | Repositorio privado: soporte, reporte y contacto rediseñados; calibración del Elo |
