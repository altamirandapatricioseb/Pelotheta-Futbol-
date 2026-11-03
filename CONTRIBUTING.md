# Cómo contribuir

Gracias por el interés. El proyecto es de una persona y el repositorio es privado; si tenés acceso:

1. **Entorno:** `just bootstrap` (ver `docs/manual_tecnico.md`).
2. **Rama:** una por cambio, desde `main`.
3. **Commits:** [Conventional Commits](https://www.conventionalcommits.org/es/) en español
   (`feat(alcance): ...`, `fix: ...`, `docs: ...`).
4. **Antes del PR:** `just lint` y `just test`; si tocás la web, `cd web && pnpm e2e`. La lógica nueva lleva su
   test.
5. **PR:** completá la plantilla. Lo revisan el CI (lint, tipos, pruebas con cobertura, Semgrep, gitleaks,
   notebooks), CodeQL y Lighthouse.
6. **Definición de Terminado:** `docs/gestion/README.md`.

Reglas que no se negocian: ninguna clave en el repositorio, las fuentes se leen respetando robots.txt y sin
evadir protecciones (`docs/adr/0008-no-evadir-protecciones-de-fuentes.md`), sin emojis en el sitio ni en la
documentación, e íconos de Phosphor.

Vulnerabilidades: no en un issue público; ver `SECURITY.md`.
