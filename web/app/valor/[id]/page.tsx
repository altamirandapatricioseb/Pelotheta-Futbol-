import type { Metadata } from 'next';
import Link from 'next/link';

import { ErrorNotice } from '@/components/error-notice';
import { ModelHeader, WaitingData } from '@/components/models/common';
import { ValuePlayer } from '@/components/models/value-player';
import { CURRENT_TEAM } from '@/config/teams';
import { getLeaguePool, getMarketValues, getModelRun } from '@/lib/data/models';

export const metadata: Metadata = {
  description: 'Valor de mercado de un jugador: cuánto se esperaría y por qué, su historial y sus comparables.',
};

export default async function ValorJugadorPage({ params }: { params: Promise<{ id: string }> }) {
  const playerId = Number((await params).id);
  const [run, values, pool] = await Promise.all([
    getModelRun(CURRENT_TEAM.slug, 'valor_mercado'),
    getMarketValues(CURRENT_TEAM.slug),
    getLeaguePool(),
  ]);
  if (!run.ok) return <ErrorNotice code={run.code} />;
  if (!values.ok) return <ErrorNotice code={values.code} />;
  const row = values.data.rows.find((r) => r.playerId === playerId);
  if (!run.data || !row) {
    return (
      <div className="grid gap-6">
        <ModelHeader title="Valor" subtitle={CURRENT_TEAM.name} />
        <WaitingData
          title="Sin datos de valor para este jugador"
          message="No tiene valor de mercado o datos completos."
        >
          <Link href="/valor" className="chip focus-ring w-fit">
            ← Volver a Valor
          </Link>
        </WaitingData>
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      <ModelHeader title="Valor" subtitle={`${CURRENT_TEAM.name} · ${row.name}: cuánto vale y por qué`} />
      <ValuePlayer
        run={run.data}
        row={row}
        rows={values.data.rows}
        coefs={values.data.coefs}
        pool={pool.ok ? pool.data : []}
      />
    </div>
  );
}
