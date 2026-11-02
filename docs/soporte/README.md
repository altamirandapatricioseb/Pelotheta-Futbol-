# Soporte: códigos de error y triage (16.6)

Cada error visible del sitio lleva un código estable. El código no cambia de significado nunca; si aparece un
problema nuevo, se crea un código nuevo. La lista vive en `web/lib/errors.ts` y una prueba comprueba que cada
código tenga su artículo acá.

| Código | Qué significa |
|---|---|
| [PEL-DB-001](PEL-DB-001.md) | La base de datos no responde |
| [PEL-NF-404](PEL-NF-404.md) | No existe esa página o ese dato |
| [PEL-SRC-003](PEL-SRC-003.md) | Una fuente de datos falló |
| [PEL-DATA-010](PEL-DATA-010.md) | Dato fuera de rango |
| [PEL-UPD-001](PEL-UPD-001.md) | El botón Actualizar no está habilitado |
| [PEL-UPD-002](PEL-UPD-002.md) | No se pudo consultar el estado de la actualización |
| [PEL-UPD-003](PEL-UPD-003.md) | La última actualización falló |

## Cómo reportar un problema

- **Dato incorrecto:** enlace «Reportar un dato incorrecto» al pie de cada página. Abre un issue de GitHub ya
  completado con la página (plantilla `dato_incorrecto.yml`). No hay formulario propio, para no sumar superficie
  de ataque.
- **Algo no funciona:** plantilla `error.yml` en Issues.
- **Vulnerabilidad:** nunca en un issue público; ver `SECURITY.md`.

## Triage

1. **Reproducir:** abrir la página del issue con los mismos filtros. Si no se reproduce, pedir más datos y
   etiquetar `necesita-info`.
2. **Clasificar:** severidad (alta: sitio caído o dato público incorrecto en una métrica principal; media: una
   página o una estadística; baja: cosmético) y prioridad (P1 esta semana, P2 este mes, P3 cuando se pueda).
3. **Ubicar la causa:** fuente (comparar contra la fuente de validación), pipeline (cálculo o regla) o web
   (presentación). El código de error, si lo hay, dice por dónde empezar.
4. **Corregir con prueba:** cada defecto corregido deja una prueba que lo reproduce.
5. **Cerrar:** con el commit o PR que lo arregla y, si el dato era de la fuente, con la nota de por qué no se
   corrige acá.
