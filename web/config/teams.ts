// Selector de equipo de la landing (país → categoría → equipo). Países de la Conmebol, los que
// juegan la Libertadores. Hoy solo hay datos de Boca: todo lo demás se muestra pero no se puede
// elegir (`available: false`). Cuando entre otro equipo, alcanza con marcarlo acá.

export interface Team {
  slug: string;
  name: string;
  available: boolean;
}

export interface Category {
  slug: string;
  name: string;
  teams: Team[];
}

export interface Country {
  slug: string;
  name: string;
  /** Código de tres letras (FIFA), para la marca chica de cada país. */
  code: string;
  categories: Category[];
}

const team = (name: string, available = false): Team => ({
  slug: name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, ''),
  name,
  available,
});

const list = (names: string[]) => names.map((n) => team(n));

export const COUNTRIES: readonly Country[] = [
  {
    slug: 'argentina',
    name: 'Argentina',
    code: 'ARG',
    categories: [
      {
        slug: 'primera-division',
        name: 'Primera División',
        teams: [
          team('Boca Juniors', true),
          ...list([
            'River Plate',
            'Racing',
            'Independiente',
            'San Lorenzo',
            'Huracán',
            'Vélez Sarsfield',
            'Estudiantes',
            'Gimnasia y Esgrima',
            'Lanús',
            'Banfield',
            'Argentinos Juniors',
            'Talleres',
            'Belgrano',
            'Instituto',
            'Rosario Central',
            "Newell's Old Boys",
            'Unión',
            'Atlético Tucumán',
            'Godoy Cruz',
            'Independiente Rivadavia',
            'Platense',
            'Tigre',
            'Defensa y Justicia',
            'Barracas Central',
            'Deportivo Riestra',
            'Sarmiento',
            'Central Córdoba',
            'San Martín de San Juan',
            'Aldosivi',
          ]),
        ],
      },
      { slug: 'primera-nacional', name: 'Primera Nacional', teams: [] },
      { slug: 'primera-b', name: 'Primera B', teams: [] },
      { slug: 'federal-a', name: 'Torneo Federal A', teams: [] },
    ],
  },
  {
    slug: 'brasil',
    name: 'Brasil',
    code: 'BRA',
    categories: [
      {
        slug: 'serie-a',
        name: 'Série A',
        teams: list(['Flamengo', 'Palmeiras', 'Botafogo', 'Fluminense', 'São Paulo', 'Corinthians', 'Grêmio']),
      },
      { slug: 'serie-b', name: 'Série B', teams: [] },
    ],
  },
  {
    slug: 'uruguay',
    name: 'Uruguay',
    code: 'URU',
    categories: [
      { slug: 'primera-division', name: 'Primera División', teams: list(['Peñarol', 'Nacional', 'Liverpool']) },
    ],
  },
  {
    slug: 'chile',
    name: 'Chile',
    code: 'CHI',
    categories: [
      {
        slug: 'primera-division',
        name: 'Primera División',
        teams: list(['Colo-Colo', 'Universidad de Chile', 'Universidad Católica']),
      },
    ],
  },
  {
    slug: 'colombia',
    name: 'Colombia',
    code: 'COL',
    categories: [
      {
        slug: 'primera-a',
        name: 'Primera A',
        teams: list(['Atlético Nacional', 'Millonarios', 'América de Cali', 'Junior']),
      },
    ],
  },
  {
    slug: 'paraguay',
    name: 'Paraguay',
    code: 'PAR',
    categories: [
      { slug: 'primera-division', name: 'Primera División', teams: list(['Olimpia', 'Cerro Porteño', 'Libertad']) },
    ],
  },
  {
    slug: 'ecuador',
    name: 'Ecuador',
    code: 'ECU',
    categories: [
      { slug: 'serie-a', name: 'Serie A', teams: list(['Liga de Quito', 'Independiente del Valle', 'Barcelona']) },
    ],
  },
  {
    slug: 'peru',
    name: 'Perú',
    code: 'PER',
    categories: [
      { slug: 'liga-1', name: 'Liga 1', teams: list(['Universitario', 'Alianza Lima', 'Sporting Cristal']) },
    ],
  },
  {
    slug: 'bolivia',
    name: 'Bolivia',
    code: 'BOL',
    categories: [
      { slug: 'primera-division', name: 'Primera División', teams: list(['Bolívar', 'The Strongest', 'Always Ready']) },
    ],
  },
  {
    slug: 'venezuela',
    name: 'Venezuela',
    code: 'VEN',
    categories: [{ slug: 'liga-futve', name: 'Liga FUTVE', teams: list(['Deportivo Táchira', 'Caracas', 'Carabobo']) }],
  },
];

export const categoryAvailable = (c: Category) => c.teams.some((t) => t.available);
export const countryAvailable = (c: Country) => c.categories.some(categoryAvailable);

/** Resuelve lo elegido desde la URL contra las listas cerradas: lo que no existe o no tiene datos se ignora. */
export function resolveChoice(pais: string | null, categoria: string | null, equipo: string | null) {
  const country = COUNTRIES.find((c) => c.slug === pais && countryAvailable(c));
  const category = country?.categories.find((c) => c.slug === categoria && categoryAvailable(c));
  const team = category?.teams.find((t) => t.slug === equipo && t.available);
  return { country, category, team };
}
