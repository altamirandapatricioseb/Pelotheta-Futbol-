import 'server-only';

import { COUNTRIES, type Country } from '@/config/teams';
import { LEAGUE_NAMES, listClubs, slug } from '@/lib/data/parquet';

const LEAGUE_ORDER = Object.values(LEAGUE_NAMES);
const rank = (league: string) => {
  const i = LEAGUE_ORDER.indexOf(league);
  return i < 0 ? LEAGUE_ORDER.length : i;
};

/** Países del selector con sus ligas y clubes del archivo abierto. Si el archivo no responde para un
 * país, queda la lista fija de config/teams.ts (Boca sigue elegible). */
export async function getChooserCountries(): Promise<Country[]> {
  return Promise.all(
    COUNTRIES.map(async (country): Promise<Country> => {
      const clubs = await listClubs(country.code);
      if (!clubs.ok || clubs.data.length === 0) return country;
      const leagues = [...new Set(clubs.data.map((c) => c.league ?? 'Otras'))].toSorted((a, b) => rank(a) - rank(b));
      return {
        ...country,
        categories: leagues.map((league) => ({
          slug: slug(league),
          name: league,
          teams: clubs.data
            .filter((c) => (c.league ?? 'Otras') === league)
            .map((c) => ({ slug: c.uid, name: c.name, available: true })),
        })),
      };
    }),
  );
}
