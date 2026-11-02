import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacidad' };

/** Política de privacidad (sección 14.7, Ley 25.326). */
export default function Page() {
  return (
    <div className="grid max-w-[70ch] gap-5">
      <h1 className="page-title">
        <span className="title-trace">Privacidad</span>
      </h1>
      <section className="grid gap-2">
        <h2 className="text-xl font-bold">Qué datos se publican y para qué</h2>
        <p>
          Pelotheta Θ es un proyecto de portfolio sin fines comerciales que analiza el rendimiento de Boca Juniors.
          Publica estadísticas deportivas de partidos y, de cada jugador del plantel, los datos que usa alguna
          estadística: nombre, posición, número, edad, altura, peso, pie hábil y nacionalidad. La edad se calcula y la
          fecha de nacimiento no se muestra.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-xl font-bold">De dónde salen</h2>
        <p>
          De fuentes públicas de resultados y estadísticas de fútbol (datos de partidos de Promiedos, con estadísticas
          de Opta). Cada dato conserva su fuente.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-xl font-bold">Visitantes</h2>
        <p>
          El sitio no tiene cuentas ni formularios, no usa cookies de terceros ni analítica, y no guarda datos de quien
          lo visita. La única cookie es la del tema claro u oscuro que elegís, y queda en tu navegador.
        </p>
      </section>
      <section className="grid gap-2">
        <h2 className="text-xl font-bold">Corrección o baja</h2>
        <p>
          Si un dato tuyo es incorrecto o querés que se quite, escribí por{' '}
          <a
            href="https://github.com/altamirandapatricioseb/Pelotheta-Futbol-/issues"
            className="focus-ring underline"
            rel="noopener noreferrer"
          >
            los issues del repositorio
          </a>
          . Para problemas de seguridad, mirá{' '}
          <a href="/.well-known/security.txt" className="focus-ring underline">
            security.txt
          </a>
          .
        </p>
      </section>
    </div>
  );
}
