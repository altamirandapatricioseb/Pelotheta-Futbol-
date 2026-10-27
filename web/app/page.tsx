import { SYSTEM_NAME, TEAM_NAME } from '@/config/brand';
import { getSystemStatus } from '@/lib/data/status';
import { formatDateTime } from '@/lib/format';

// Página de la etapa 1: comprueba de punta a punta que Vercel lee Supabase con la clave
// publicable a través del esquema `api`. La reemplaza la Interfaz 1 (gráficos) más adelante.
export default async function Home() {
  const status = await getSystemStatus();

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 px-4 py-12 sm:px-8">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-line pb-6">
        <p className="text-lg font-bold">{TEAM_NAME}</p>
        <h1 className="text-3xl font-extrabold tracking-tight">{SYSTEM_NAME}</h1>
      </header>

      <section aria-labelledby="estado" className="rounded-xl border border-line bg-surface p-6">
        <h2 id="estado" className="text-xl font-bold">
          Etapa 1 · Preparación
        </h2>

        {status.ok ? (
          <>
            <p className="mt-2 text-muted">
              Conexión con la base de datos: <strong className="text-link">correcta</strong>. Estas filas se leen en
              vivo desde la vista pública <code>api.system_status</code>.
            </p>
            <table className="tabular mt-4 w-full text-left text-sm">
              <caption className="sr-only">Estado del sistema leído desde Supabase</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Clave
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Valor
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    Actualizado
                  </th>
                </tr>
              </thead>
              <tbody>
                {status.rows.map((row) => (
                  <tr key={row.key} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4">{row.key}</td>
                    <td className="py-2 pr-4">{row.value}</td>
                    <td className="py-2">{formatDateTime(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div role="alert" className="mt-2">
            <p className="font-semibold">{status.code}: la base de datos no responde.</p>
            <p className="mt-1 text-muted">
              Puede estar pausada por inactividad. El sitio sigue funcionando y muestra los datos apenas vuelva.
            </p>
          </div>
        )}
      </section>

      <footer className="mt-auto text-sm text-muted">
        Proyecto de portfolio sin fines comerciales. Las interfaces del sistema se publican por etapas.
      </footer>
    </main>
  );
}
