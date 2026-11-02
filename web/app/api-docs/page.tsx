import type { Metadata } from 'next';

import { readPublicEnv } from '@/lib/env';
import spec from '@/public/openapi.json';

export const metadata: Metadata = {
  title: 'API',
  description: 'API de solo lectura de Pelotheta Θ: vistas, columnas, ejemplos y límites (OpenAPI 3.1).',
};

interface Column {
  type?: string;
  format?: string;
  description?: string;
}
interface Schema {
  description?: string;
  properties: Record<string, Column>;
}

const SERVER = spec.servers[0]?.url ?? '';
const SCHEMAS = spec.components.schemas as Record<string, Schema>;
const FUNCTIONS = Object.keys(spec.paths).filter((p) => p.startsWith('/rpc/'));

const curl = (
  key: string,
) => `curl "${SERVER}/boca_match?select=match_date,opponent,goals_for,goals_against&order=match_date.desc&limit=5" \\
  -H "apikey: ${key}" \\
  -H "Accept-Profile: api"`;

const TS = `import { createClient } from '@supabase/supabase-js';

const api = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { db: { schema: 'api' } });

const { data, error } = await api
  .from('boca_match')
  .select('match_date, opponent, goals_for, goals_against')
  .order('match_date', { ascending: false })
  .limit(5);

// Funciones: serie de una estadística de un jugador (9.8).
const serie = await api.rpc('stat_series', { p_stat: 'goles', p_entity: 'jugador', p_id: 6 });`;

/** Documentación de la API de solo lectura (16.2): la misma Data API que usa el sitio. */
export default function Page() {
  // La clave publicable es pública por diseño: solo lectura (RLS) y 3 s por consulta.
  const key = readPublicEnv().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return (
    <div className="grid max-w-[80ch] gap-6">
      <h1 className="page-title">
        <span className="title-trace">API de solo lectura</span>
      </h1>
      <p>
        Todo lo que muestra el sitio sale de las vistas del esquema <code>api</code> de Supabase, expuestas por
        PostgREST. Se pueden consultar directamente: no hay endpoints propios ni escrituras. La especificación completa
        está en{' '}
        <a href="/openapi.json" className="focus-ring font-semibold text-link underline">
          /openapi.json
        </a>{' '}
        (OpenAPI 3.1), lista para Postman, Insomnia o cualquier generador de clientes.
      </p>

      <section className="grid gap-2">
        <h2 className="text-xl font-bold">Reglas</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Cabecera <code>apikey</code> con la clave publicable <code className="break-all">{key}</code> (es pública;
            la seguridad la da RLS) y <code>Accept-Profile: api</code>.
          </li>
          <li>
            Hasta 1000 filas por pedido: paginá con <code>limit</code> y <code>offset</code>.
          </li>
          <li>Cada consulta tiene un tiempo máximo de 3 segundos.</li>
          <li>
            Filtros de PostgREST en cada columna (<code>?goals_for=gte.2</code>), <code>select</code> para elegir
            columnas y <code>order</code> para ordenar.
          </li>
          <li>
            <code>POST</code>, <code>PATCH</code> y <code>DELETE</code> se rechazan: la clave pública no tiene permiso
            de escritura en ninguna vista.
          </li>
        </ul>
      </section>

      <section className="grid gap-2">
        <h2 className="text-xl font-bold">Ejemplo con curl</h2>
        <pre className="code-block">
          <code>{curl(key)}</code>
        </pre>
        <h2 className="text-xl font-bold">Ejemplo con TypeScript</h2>
        <pre className="code-block">
          <code>{TS}</code>
        </pre>
      </section>

      <section className="grid gap-2">
        <h2 className="text-xl font-bold">
          Vistas ({Object.keys(SCHEMAS).length}) y funciones ({FUNCTIONS.length})
        </h2>
        <p className="text-muted">
          Funciones: {FUNCTIONS.map((f) => f.replace('/rpc/', '')).join(' y ')}, con los parámetros <code>p_stat</code>,{' '}
          <code>p_entity</code> (<code>jugador</code>, <code>equipo</code>, <code>rival</code> o <code>arbitro</code>) y{' '}
          <code>p_id</code>.
        </p>
        {Object.entries(SCHEMAS).map(([name, schema]) => (
          <details key={name} className="api-view">
            <summary className="focus-ring">
              <code className="font-bold">{name}</code>
              {schema.description ? <span className="text-muted"> · {schema.description}</span> : null}
            </summary>
            <table className="data-table">
              <caption className="sr-only">Columnas de {name}</caption>
              <thead>
                <tr>
                  <th scope="col">Columna</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Nota</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(schema.properties).map(([column, c]) => (
                  <tr key={column}>
                    <th scope="row">
                      <code>{column}</code>
                    </th>
                    <td className="text-left">{c.format ?? c.type ?? '—'}</td>
                    <td className="text-left">{c.description ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </section>
    </div>
  );
}
