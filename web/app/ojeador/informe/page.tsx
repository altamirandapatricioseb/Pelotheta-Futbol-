import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ErrorNotice } from '@/components/error-notice';
import { ModelHeader } from '@/components/models/common';
import { type ReportStatRow, ScoutReportView } from '@/components/models/scout-report';
import { CURRENT_TEAM } from '@/config/teams';
import { getCatalog } from '@/lib/data/catalog';
import { loadScouting } from '@/lib/data/scouting';
import { marketStats } from '@/lib/models/market-stats';
import { scoutReports } from '@/lib/models/scouting';
import { type PlayerRow, playerValue, rankAndPercentile } from '@/lib/stats/catalog';

export const metadata: Metadata = {
  description:
    'Informe completo de ojeador: todas las estadísticas contra la liga y contra los titulares propios, y su precio en el mercado.',
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const MIN_LEAGUE = 450;
const STARTERS: Record<string, number> = { Arquero: 1, Defensor: 4, Mediocampista: 3, Delantero: 3 };

interface Source {
  name: string;
  position: string | null;
  age: number | null;
  minutes: number | null;
  stats: Record<string, number>;
}

const row = (p: Source): PlayerRow => ({
  playerId: 0,
  name: p.name,
  shortName: null,
  position: p.position,
  shirtNumber: null,
  age: p.age,
  heightCm: null,
  weightKg: null,
  foot: null,
  nationality: null,
  matches: 0,
  minutes: p.minutes ?? 0,
  stats: p.stats,
});

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export default async function InformePage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const name = first(raw.jugador);
  const club = first(raw.club);
  if (!name || !club) notFound();
  const [loaded, catalog] = await Promise.all([loadScouting(CURRENT_TEAM), getCatalog('player')]);
  if (!loaded.ok || !catalog.ok) {
    return (
      <div className="grid gap-6">
        <ModelHeader title="Informe de ojeador" subtitle={CURRENT_TEAM.name} />
        <ErrorNotice code="PEL-DB-001" />
      </div>
    );
  }
  const { market, needs, squad } = loaded.data;
  const report = scoutReports(market, needs, Infinity).find((r) => r.player.name === name && r.player.team === club);
  if (!report) notFound();
  const group = report.group;
  const line = group.toLowerCase();

  // Todas las estadísticas del catálogo que se ven en los jugadores propios y aplican al puesto.
  const stats = catalog.data.filter(
    (s) =>
      s.available && s.rule !== 'nd' && s.rule !== 'perfil' && (s.lines.includes('todas') || s.lines.includes(line)),
  );
  const peers = market.filter(
    (p) => p.position === group && (p.minutes ?? 0) >= MIN_LEAGUE && Object.keys(p.stats).length > 0,
  );
  const starters = squad
    .filter((p) => p.position === group)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, STARTERS[group] ?? 3);
  const me = row(report.player);
  const values = (list: Source[], s: (typeof stats)[number]) =>
    list.flatMap((p) => {
      const v = num(playerValue(row(p), s, true));
      return v === null ? [] : [v];
    });
  const rows: ReportStatRow[] = stats.map((s) => {
    const value = num(playerValue(me, s, true));
    const league = values(peers, s);
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      unit: s.unit,
      per90: s.per90,
      higherIsBetter: s.higherIsBetter,
      value,
      percentile:
        value !== null && league.length >= 5 ? rankAndPercentile(league, value, s.higherIsBetter).percentile : null,
      leagueMedian: median(league),
      ownMedian: median(values(starters, s)),
    };
  });

  return (
    <div className="grid gap-6">
      <Link href="/ojeador#informes" className="chip focus-ring w-fit">
        ← Volver al Ojeador
      </Link>
      <ModelHeader
        title={report.player.name}
        subtitle={`Informe de ojeador · ${report.player.team} · ${group} · para ${CURRENT_TEAM.name}`}
      />
      <ScoutReportView
        report={report}
        rows={rows}
        team={CURRENT_TEAM.name}
        starters={starters.map((p) => p.name)}
        leaguePeers={peers.length}
        market={market.flatMap((p) =>
          p.position === group && p.value !== null && p.age !== null
            ? [{ name: p.name, team: p.team, age: p.age, value: p.value }]
            : [],
        )}
        curve={marketStats(market, squad)?.curves.find((c) => c.group === group)?.points ?? []}
        own={squad.flatMap((p) =>
          p.position === group && p.value !== null && p.age !== null
            ? [{ name: p.name, age: p.age, value: p.value }]
            : [],
        )}
      />
    </div>
  );
}
