# ADR 0005: Next.js en Vercel frente a Streamlit

- Estado: aceptada (27-oct-2026, etapa 1)

## Contexto
El sitio tiene que estar siempre online, gratis, con seis interfaces, doble clic entre vistas, animaciones y
una CSP estricta. Streamlit es rápido para prototipos de datos, pero necesita un servidor encendido
permanentemente y no encaja con las funciones serverless de Vercel.

## Decisión
Next.js (App Router, Server Components) con TypeScript estricto en Vercel; los datos se leen de la Data API
de Supabase. Python queda para el pipeline, donde están las fuentes y los cálculos.

## Consecuencias
- Sin servidor que mantener y con plan gratuito. Dos lenguajes en el repositorio.
- La lógica de presentación vive en TypeScript (`web/lib`), con sus propios tests.
