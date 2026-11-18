import type { Metadata } from 'next';

import { ErrorNotice } from '@/components/error-notice';
import { ModelHeader } from '@/components/models/common';
import { ValueView } from '@/components/models/value-view';
import { CURRENT_TEAM } from '@/config/teams';
import { getMarketValues, getModelRun } from '@/lib/data/models';

export const metadata: Metadata = {
  description:
    'Valor de mercado de cada jugador contra el que espera una regresión entrenada con toda la liga (edad, posición, contrato, club) y ajustada por rendimiento.',
};

export default async function ValorPage() {
  const [run, values] = await Promise.all([
    getModelRun(CURRENT_TEAM.slug, 'valor_mercado'),
    getMarketValues(CURRENT_TEAM.slug),
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
        <ValueView run={run.data} rows={values.data.rows} coefs={values.data.coefs} />
      )}
    </div>
  );
}
