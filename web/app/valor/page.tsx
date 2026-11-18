import type { Metadata } from 'next';

import { ErrorNotice } from '@/components/error-notice';
import { ModelHeader } from '@/components/models/common';
import { ValueView } from '@/components/models/value-view';
import { CURRENT_TEAM } from '@/config/teams';
import { getLeaguePool, getMarketValues, getModelRun } from '@/lib/data/models';

export const metadata: Metadata = {
  description:
    'Valor de mercado de cada jugador contra el que espera una regresión entrenada con toda la liga (edad, posición, contrato, club) y ajustada por rendimiento.',
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ValorPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const requested = Number(Array.isArray(raw.jugador) ? raw.jugador[0] : raw.jugador);
  const [run, values, pool] = await Promise.all([
    getModelRun(CURRENT_TEAM.slug, 'valor_mercado'),
    getMarketValues(CURRENT_TEAM.slug),
    getLeaguePool(),
  ]);
  return (
    <div className="grid gap-6">
      <ModelHeader
        title="Valor"
        subtitle={`${CURRENT_TEAM.name} · lo que vale en el mercado contra lo que se esperaría por edad, contrato, club y rendimiento`}
      />
      {!run.ok ? (
        <ErrorNotice code={run.code} />
      ) : !values.ok ? (
        <ErrorNotice code={values.code} />
      ) : (
        <ValueView
          // La clave reinicia la selección cuando se llega desde una fila de la tabla (?jugador=).
          key={Number.isInteger(requested) ? requested : 'inicio'}
          run={run.data}
          rows={values.data.rows}
          coefs={values.data.coefs}
          pool={pool.ok ? pool.data : []}
          initialPlayer={Number.isInteger(requested) && requested > 0 ? requested : null}
        />
      )}
    </div>
  );
}
