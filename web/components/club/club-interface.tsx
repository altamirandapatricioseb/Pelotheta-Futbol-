import Link from 'next/link';

import { ErrorNotice } from '@/components/error-notice';
import { TeamTableView } from '@/components/team/team-table';
import { getCatalog, getStatSets } from '@/lib/data/catalog';
import { getClub, getClubTeamMatches, getLeagueProfiles, type Club } from '@/lib/data/parquet';
import { getLeagueClubs } from '@/lib/data/team';

import { ClubAlternatives, ClubScout } from './club-scout';
import { type ClubSection, ClubSections } from './club-sections';

// Cada interfaz de Boca, para cualquier otro club: las secciones de su ficha que corresponden y una
// nota de lo que solo Boca tiene (el detalle por partido de jugadores y equipo, que para el resto de
// los clubes las fuentes permitidas no dejan publicar).
export type ClubView =
  'equipo' | 'jugadores' | 'situaciones' | 'predictor' | 'valor' | 'comparar' | 'graficos' | 'alternativas' | 'ojeador';

const VIEWS: Record<ClubView, { title: string; sections: readonly ClubSection[]; only?: string }> = {
  equipo: {
    title: 'Equipo',
    sections: ['nivel', 'partidos', 'posiciones', 'destacados'],
    only: 'El xG, la defensa y las métricas propias por partido',
  },
  jugadores: {
    title: 'Jugadores',
    sections: ['plantel'],
    only: 'Las estadísticas partido a partido de cada jugador',
  },
  situaciones: { title: 'Situaciones', sections: ['situaciones'], only: 'Las situaciones por evento del partido' },
  predictor: { title: 'Predictor', sections: ['proximo', 'nivel'], only: 'El backtest y las pruebas de hipótesis' },
  valor: { title: 'Valor', sections: ['valor'] },
  comparar: { title: 'Comparar', sections: [] },
  alternativas: { title: 'Alternativas', sections: [], only: 'Las duplas y los reemplazos dentro del plantel' },
  ojeador: { title: 'Ojeador', sections: [], only: 'Los informes con nota por puesto' },
  graficos: {
    title: 'Gráficos',
    sections: ['nivel', 'situaciones', 'posiciones'],
    only: 'Los gráficos partido a partido',
  },
};

// Lo que cada sección necesita para tener algo que mostrar.
const HAS_DATA: Record<ClubSection, (c: Club) => boolean> = {
  proximo: (c) => c.next !== null,
  nivel: (c) => c.strength !== null,
  situaciones: (c) => c.situation !== null,
  destacados: (c) => c.leaders.length > 0,
  plantel: (c) => c.squad.length > 0,
  valor: (c) => c.values.length > 0,
  partidos: () => true, // dice «todavía no hay partidos» por su cuenta
  posiciones: (c) => c.standings.length > 0,
};

/** La tabla de Equipo de Boca con los partidos de liga del club (estadísticas de Promiedos). */
async function TeamTable({ club }: { club: Club }) {
  const [matches, catalog, sets, clubs] = await Promise.all([
    getClubTeamMatches(club.uid, club.name),
    getCatalog('team'),
    getStatSets('team'),
    getLeagueClubs(),
  ]);
  if (!matches.ok) return <ErrorNotice code={matches.code} />;
  if (!catalog.ok || !sets.ok || matches.data.length === 0) return null;
  return (
    <TeamTableView
      matches={matches.data}
      catalog={catalog.data}
      sets={sets.data}
      windowValues={{}}
      clubs={clubs.ok ? clubs.data : []}
      initialSet={null}
      initialView="partido"
      matchBase={`/club/${club.uid}/partido/`}
    />
  );
}

async function CompareForm({ club }: { club: Club }) {
  const league = await getLeagueProfiles(club.uid);
  const mine = club.squad.filter((p) => p.player_id);
  if (!league.ok) return <ErrorNotice code={league.code} />;
  if (mine.length === 0) {
    return <p className="text-muted">Todavía no hay jugadores de este club con perfil en el archivo abierto.</p>;
  }
  return (
    <form method="get" action="/comparar" className="grid max-w-xl gap-4">
      <label htmlFor="a" className="grid gap-1">
        <span className="font-bold">Jugador de {club.name}</span>
        <select id="a" name="a" className="focus-ring" required>
          {mine.map((p) => (
            <option key={p.player_id ?? p.player_name} value={p.player_id ?? ''}>
              {p.player_name} ({p.position ?? 'sin posición'})
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="b" className="grid gap-1">
        <span className="font-bold">Contra cualquier jugador de la liga</span>
        <select id="b" name="b" className="focus-ring" required>
          {league.data.map((p) => (
            <option key={p.player_id ?? `${p.team_name}-${p.player_name}`} value={p.player_id ?? ''}>
              {p.player_name} ({p.team_name}, {p.position ?? 'sin posición'})
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="focus-ring justify-self-start underline">
        Comparar
      </button>
    </form>
  );
}

async function LeagueView({ view, club }: { view: 'alternativas' | 'ojeador'; club: Club }) {
  const league = await getLeagueProfiles(club.uid);
  if (!league.ok) return <ErrorNotice code={league.code} />;
  return view === 'alternativas' ? (
    <ClubAlternatives club={club} league={league.data} />
  ) : (
    <ClubScout club={club} league={league.data} />
  );
}

/** La interfaz `view` de un club que no es Boca, con los datos de temporada del archivo abierto. */
export async function ClubInterface({ view, uid }: { view: ClubView; uid: string }) {
  const result = await getClub(uid);
  if (!result.ok) return <ErrorNotice code={result.code} />;
  const club = result.data;
  const v = VIEWS[view];
  if (club === null) {
    return (
      <div className="grid gap-4">
        <h1 className="page-title">
          <span className="title-trace">{v.title}</span>
        </h1>
        <p className="text-muted">
          Este club ya no está en el archivo abierto.{' '}
          <Link href="/elegir" className="focus-ring underline">
            Elegí otro equipo
          </Link>
          .
        </p>
      </div>
    );
  }
  const shown = v.sections.filter((s) => HAS_DATA[s](club));
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="page-title">
          <span className="title-trace">{v.title}</span>
        </h1>
        <p className="mt-2 text-muted">
          {club.name} · {club.country ?? 'Conmebol'} · temporada 2026 ·{' '}
          <Link href={`/club/${club.uid}`} className="focus-ring underline">
            ficha completa
          </Link>{' '}
          ·{' '}
          <Link href="/elegir" className="focus-ring underline">
            cambiar de equipo
          </Link>
        </p>
      </div>
      {view === 'equipo' ? <TeamTable club={club} /> : null}
      {view === 'comparar' ? <CompareForm club={club} /> : null}
      {view === 'alternativas' || view === 'ojeador' ? <LeagueView view={view} club={club} /> : null}
      {v.sections.length > 0 && shown.length === 0 ? (
        <p className="text-muted">Todavía no hay datos de esto para {club.name} en el archivo abierto.</p>
      ) : null}
      <ClubSections club={club} show={shown} />
      {v.only ? (
        <p className="text-sm text-muted">
          {v.only} solo están para Boca: de los demás clubes, las fuentes que se pueden publicar dan resultados, tablas
          y promedios de temporada, no el detalle por partido.
        </p>
      ) : null}
    </div>
  );
}
