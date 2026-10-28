// Vistas de la tabla del equipo (9.5): por partido, rival, mes, competición o acumulada.
// Solo agrupa filas; los valores de cada grupo los calcula `aggregateTeam` con las reglas del
// catálogo, así que un total por rival se calcula igual que un total de temporada.

import type { TeamMatchRow } from './catalog';

export type TeamView = 'partido' | 'rival' | 'mes' | 'competicion' | 'acumulada';

export const TEAM_VIEWS: readonly { id: TeamView; label: string }[] = [
  { id: 'partido', label: 'Por partido' },
  { id: 'rival', label: 'Por rival' },
  { id: 'mes', label: 'Por mes' },
  { id: 'competicion', label: 'Por competición' },
  { id: 'acumulada', label: 'Acumulada' },
];

export interface MatchGroup {
  key: string;
  label: string;
  rows: TeamMatchRow[];
}

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/** «2-1 G»: marcador desde Boca y resultado (G, E o P). La tanda de penales no cuenta. */
export function resultLabel(row: TeamMatchRow): string {
  const letter = row.goalsFor > row.goalsAgainst ? 'G' : row.goalsFor === row.goalsAgainst ? 'E' : 'P';
  return `${String(row.goalsFor)}-${String(row.goalsAgainst)} ${letter}`;
}

function shortDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

function groupBy(rows: readonly TeamMatchRow[], keyOf: (r: TeamMatchRow) => [string, string]): MatchGroup[] {
  const map = new Map<string, MatchGroup>();
  for (const row of rows) {
    const [key, label] = keyOf(row);
    const group = map.get(key) ?? { key, label, rows: [] };
    group.rows.push(row);
    map.set(key, group);
  }
  return [...map.values()];
}

/** Grupos de partidos para la vista elegida; los partidos llegan ordenados por fecha. */
export function groupMatches(rows: readonly TeamMatchRow[], view: TeamView): MatchGroup[] {
  switch (view) {
    case 'partido':
      return rows.map((r) => ({
        key: String(r.matchId),
        label: `${shortDate(r.date)} · ${r.home ? 'vs' : 'en'} ${r.opponent}`,
        rows: [r],
      }));
    case 'rival':
      return groupBy(rows, (r) => [r.opponent, r.opponent]).toSorted((a, b) => a.label.localeCompare(b.label, 'es'));
    case 'mes':
      return groupBy(rows, (r) => {
        const [year, month] = r.date.split('-');
        return [`${year ?? ''}-${month ?? ''}`, `${MONTHS[Number(month) - 1] ?? ''} ${year ?? ''}`];
      });
    case 'competicion':
      return groupBy(rows, (r) => [r.competitionCode, r.competitionName]);
    case 'acumulada':
      return rows.length ? [{ key: 'todas', label: 'Temporada 2026', rows: [...rows] }] : [];
  }
}
