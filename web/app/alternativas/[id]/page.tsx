import type { Metadata } from 'next';
import Link from 'next/link';

import { ErrorNotice } from '@/components/error-notice';
import { AlternativeDetail } from '@/components/models/alternative-detail';
import { ModelHeader, WaitingData } from '@/components/models/common';
import { CURRENT_TEAM } from '@/config/teams';
import { getAlternatives, getMarketValues, getModelRun } from '@/lib/data/models';
import { getPlayerMaster } from '@/lib/data/players';

export const metadata: Metadata = {
  description: 'Desglose de una alternativa: perfil, qué se gana y qué se pierde, y precio contra parecido.',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AlternativaPage({ params, searchParams }: PageProps) {
  const [{ id }, raw] = await Promise.all([params, searchParams]);
  const playerId = Number(id);
  const [run, data, values, master] = await Promise.all([
    getModelRun(CURRENT_TEAM.slug, 'alternativas'),
    getAlternatives(CURRENT_TEAM.slug),
    getMarketValues(CURRENT_TEAM.slug),
    getPlayerMaster('todas'),
  ]);
  if (!run.ok) return <ErrorNotice code={run.code} />;
  if (!data.ok) return <ErrorNotice code={data.code} />;
  const target = data.data.styles.find((s) => s.playerId === playerId);
  const options = data.data.alternatives
    .filter((a) => a.playerId === playerId)
    .sort((a, b) => b.similarity - a.similarity);
  const chosen =
    options.find((a) => a.section === first(raw.seccion) && String(a.rank) === first(raw.opcion)) ?? options[0];
  if (!run.data || !target || !chosen) {
    return (
      <div className="grid gap-6">
        <ModelHeader title="Alternativas" subtitle={CURRENT_TEAM.name} />
        <WaitingData title="No hay alternativas para este jugador" message="Puede que no tenga minutos suficientes.">
          <Link href="/alternativas" className="chip focus-ring w-fit">
            ← Volver a Alternativas
          </Link>
        </WaitingData>
      </div>
    );
  }
  const value = values.ok ? values.data.rows.find((r) => r.playerId === playerId) : undefined;
  const player = master.ok ? master.data.find((p) => p.playerId === playerId) : undefined;
  return (
    <div className="grid gap-6">
      <ModelHeader title="Alternativas" subtitle={`${CURRENT_TEAM.name} · ${target.name}: la comparación completa`} />
      <AlternativeDetail
        run={run.data}
        target={target}
        targetValue={value?.actual ?? null}
        targetAge={player?.age ?? value?.detail.age ?? null}
        targetMinutes={player?.minutes ?? null}
        options={options}
        chosen={chosen}
        styles={data.data.styles}
      />
    </div>
  );
}
