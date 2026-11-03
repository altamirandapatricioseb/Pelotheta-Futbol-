# Plan e informe de pruebas

Estilo ISO/IEC/IEEE 29119 simplificado. La estrategia por nivel está en `estrategia.md`; los casos, con el
resultado de la última corrida, en `matriz_casos_prueba.xlsx` (y `.csv`).

## Alcance

**Dentro:** pipeline (adaptadores, cálculos, carga, Excel, Power BI, backup), base de datos (RLS,
permisos, calidad de datos), web (lógica, accesibilidad, seguridad, regresión visual, rendimiento) y
notebooks. **Fuera:** las plataformas (Vercel, Supabase, GitHub) y las fuentes de terceros, salvo su
respuesta guardada en los tests de cada adaptador.

## Entornos

| Entorno | Para qué |
|---|---|
| Local (Windows, Python 3.13, Node 24) | Unidad, e2e contra `next dev`, regresión visual (líneas base de Windows) |
| CI (GitHub Actions, ubuntu-latest) | Unidad con cobertura, notebooks, Semgrep, gitleaks, CodeQL, Lighthouse en PR |
| Producción (`pelotheta-futbol.vercel.app`) | e2e de accesibilidad y ZAP semanales, salud cada 6 horas |
| Base (Supabase) | pgTAP por MCP o SQL Editor; chequeos de calidad en cada carga |

## Criterios de entrada

El código compila (tipos), el lint pasa y la rama tiene los tests de la lógica nueva.

## Criterios de salida

| Criterio | Umbral | Resultado (2-nov-2026) |
|---|---|---|
| Pruebas automatizadas | 0 fallas | 558 casos: 500 pasan, 58 omitidos (los de base sin clave en el entorno y los de escritorio en celular), 0 fallan |
| Cobertura de la lógica del pipeline | ≥ 85 % | 89 % |
| Cobertura de la lógica de la web | ≥ 80 % de líneas | 93 % |
| Accesibilidad | 0 violaciones de axe | 0 en 14 rutas, 2 temas y 2 dispositivos |
| Seguridad de la base | pgTAP completo | 10/10 |
| Calidad de datos | 0 chequeos con fallas | 16/16 |
| Notebooks | Se ejecutan de punta a punta | 5/5 |
| Rendimiento | Presupuesto de Lighthouse | Dentro (ver `docs/slo.md`) |

## Defectos encontrados (y corregidos)

| Defecto | Cómo se encontró | Corrección |
|---|---|---|
| Enlace al inicio con nombre accesible distinto del texto visible | axe en todas las rutas | Texto oculto en vez de `aria-label` |
| Lista de definiciones con un enlace adentro (Equipo) | axe | El enlace sale del `dl` |
| Contraste bajo en etiquetas de conclusión y chips | axe | Mezcla del tono con el color del texto |
| Situaciones se salía 61 px de costado en el celular | Prueba sin desplazamiento horizontal | Columnas de grilla `minmax(0, 1fr)` |
| La conciliación sumaba los penales de la definición | Chequeo de calidad | Se excluye el período 5 |
| La landing tenía 9.701 elementos y TBT de 1,87 s | Lighthouse | Gráficos montados al acercarse (2.955 y 1,24 s) |
| El Elo sobreestimaba la localía | Notebook 03 (curva de calibración) | K = 30 y V = 50 |
| Enlaces de soporte y reporte a un repositorio privado | Al configurar Scorecard | Página `/soporte`; reporte quitado |

## Riesgos de las pruebas

- Las e2e corren contra datos reales: un cambio grande de datos puede pedir actualizar las líneas base
  visuales (`pnpm e2e --update-snapshots`).
- pgTAP no corre en CI (necesita la contraseña de la base).
- La prueba de carga con k6 no se corrió (sin k6 instalado y con el preview protegido).
