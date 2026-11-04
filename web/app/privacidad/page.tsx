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
          Si un dato tuyo es incorrecto o querés que se quite, contactá al responsable del proyecto desde{' '}
          <a
            href="https://github.com/altamirandapatricioseb"
            className="focus-ring underline"
            rel="noopener noreferrer"
          >
            su perfil de GitHub
          </a>
          . Se responde dentro de los 10 días hábiles que fija la ley y la baja se aplica en la carga siguiente.
        </p>
      </section>
      <section id="seguridad" className="grid scroll-mt-24 gap-2">
        <h2 className="text-xl font-bold">Seguridad</h2>
        <p>
          Si encontrás una vulnerabilidad, avisá por el mismo contacto y no la publiques hasta que esté corregida. La
          respuesta inicial llega en 7 días como máximo. Las pruebas tienen que ser pasivas: nada de denegación de
          servicio, ingeniería social ni acceso a datos de terceros. La información completa está en{' '}
          <a href="/.well-known/security.txt" className="focus-ring underline">
            security.txt
          </a>
          .
        </p>
      </section>
    </div>
  );
}
