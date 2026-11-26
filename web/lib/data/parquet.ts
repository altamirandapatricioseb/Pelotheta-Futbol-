import 'server-only';

import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { z } from 'zod';

import { lambdas, outcomes, type Profile, scoreMatrix } from '@/lib/models/predictor';

// Capa fría pública (docs/formato-parquet.md). Se lee en el servidor y se cachea una hora: Hugging
// Face recibe un pedido por archivo y hora, no uno por visita (límite anónimo: 3000 cada 5 min por IP).
export const DATASET_URL = 'https://huggingface.co/datasets/pelotheta/pelotheta-futbol';
const BASE = `${DATASET_URL}/resolve/main/`;
const REVALIDATE_S = 3600;

export type ArchiveResult<T> = { ok: true; data: T } | { ok: false; code: 'PEL-ARC-001'; detail: string };

// pyarrow escribe los enteros como INT64 y hyparquet los devuelve como bigint. El faltante sigue null.
const num = z.union([z.number(), z.bigint().transform(Number)]).nullable();
const text = z.string().nullable();

const manifestSchema = z.object({
  archivos: z.array(z.object({ ruta: z.string(), tabla: z.string() })),
});

const identitySchema = z.object({
  uid: z.string(),
  name: z.string(),
  short_name: text,
  country: text,
  country_code: text,
  aliases: text,
});

// Partidos del equipo con todas sus competiciones (hoy solo Boca, desde Supabase).
const teamMatchSchema = z.object({
  match_date: z.string(),
  round_label: text,
  competition_name: text,
  boca_home: z.boolean().nullable(),
  opponent: text,
  goals_for: num,
  goals_against: num,
});

// Todos los partidos de liga (Promiedos): la base para cualquier equipo sin archivo propio.
// Árbitro, tarjetas, faltas, bajas y minutos de gol solo vienen de Promiedos; la Liga Profesional (desde
// Supabase) puede no traer `ext_id`. Los minutos van como texto JSON («[12, 45]»).
const leagueResultSchema = z.object({
  source: z.string(),
  ext_id: text.optional(),
  stage: text,
  match_date: z.string(),
  home_team: z.string(),
  away_team: z.string(),
  home_goals: num,
  away_goals: num,
  referee: text.optional(),
  yellow_home: num.optional(),
  yellow_away: num.optional(),
  red_home: num.optional(),
  red_away: num.optional(),
  fouls_home: num.optional(),
  fouls_away: num.optional(),
  injured_home: num.optional(),
  injured_away: num.optional(),
  suspended_home: num.optional(),
  suspended_away: num.optional(),
  home_goal_minutes: text.optional(),
  away_goal_minutes: text.optional(),
});

// Fuerza del predictor (cálculo propio): 1 = promedio de la liga; ataque > 1 convierte más, defensa > 1 recibe más.
const strengthSchema = z.object({
  team_name: z.string(),
  competition: text,
  estimated: z.boolean().nullable(),
  attack_home: num,
  defense_home: num,
  attack_away: num,
  defense_away: num,
  elo: num,
  form: num,
  squad_value_eur: num,
});

const leaderSchema = z.object({
  source: z.string(),
  stat: z.string(),
  rank: num,
  player_name: z.string(),
  team_name: text,
  value: num,
});

// Perfiles de jugadores de toda la liga (cálculo propio sobre Bzzoiro): percentil 0 a 100 cada 90 minutos
// contra los de la misma posición; null cuando la estadística no aplica (atajadas de un delantero).
// Columnas de texto que la exportación agrega a cada fila de liga (etapa 5j): sin declararlas, un
// `catchall(num)` las rechaza.
const leagueTags = { country_code: text.optional(), competition_uid: text.optional() };

// Perfil público por jugador: `pct_<estadística>` (percentil contra su posición en la liga) y
// `per90_<estadística>` (promedio cada 90). `player_id` y los `per90_` faltan en archivos viejos.
const profileSchema = z
  .object({
    player_id: z.string().nullish(),
    player_name: z.string(),
    team_name: z.string(),
    position: text,
    minutes: num,
    matches: num,
    ...leagueTags,
  })
  .catchall(num);
export type PlayerProfile = z.infer<typeof profileSchema>;

// Valor real (transfermarkt-datasets, CC0) y esperado por el modelo propio, fuera de muestra.
const marketValueSchema = z.object({
  player_name: z.string(),
  team_name: z.string(),
  position_group: text,
  age: num,
  value_eur: num,
  predicted_eur: num,
  gap_pct: num,
});
export type MarketValue = z.infer<typeof marketValueSchema>;

// Situaciones por club (cálculo propio sobre resultados y minutos de gol de Promiedos).
export const BUCKETS = ['0_15', '16_30', '31_45', '46_60', '61_75', '76_90'] as const;
// Las columnas sin nombrar (goles por tramo `favor_0_15`…, puntos, ppp) son todas numéricas.
const situationSchema = z.object({ team_name: z.string(), racha: text, ...leagueTags }).catchall(num);
export type Situation = z.infer<typeof situationSchema>;

const fixtureSchema = z.object({
  match_date: z.string(),
  stage: text,
  home_team: z.string(),
  away_team: z.string(),
});

// model_run guarda `metrics` como texto JSON; del predictor se usan los β del GLM y los valores por defecto.
const modelRunSchema = z.object({ model: z.string(), metrics: text });
const predictorMetricsSchema = z.object({
  glm: z.object({ names: z.array(z.string()), beta: z.array(z.number()) }),
  league_elo: z.number().optional(),
  default_form: z.number().optional(),
});

export interface NextMatch {
  date: string;
  stage: string | null;
  home: boolean;
  opponent: string;
  win: number;
  draw: number;
  loss: number;
  goalsOwn: number;
  goalsRival: number;
}

const standingSchema = z.object({
  table_name: z.string(),
  rank: num,
  team_name: z.string(),
  played: num,
  won: num,
  drawn: num,
  lost: num,
  goals_for: num,
  goals_against: num,
  points: num,
});

export interface ClubMatch {
  /** Id del partido de liga en su fuente (para su ficha); null en los del archivo propio del club. */
  id: string | null;
  date: string;
  competition: string | null;
  home: boolean | null;
  opponent: string | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
}
export type LeagueResult = z.infer<typeof leagueResultSchema>;
export type StandingRow = z.infer<typeof standingSchema>;
export interface ClubLink {
  uid: string;
  name: string;
  league: string | null;
}
export interface StandingTable {
  name: string;
  rows: StandingRow[];
}
export interface Club {
  uid: string;
  name: string;
  country: string | null;
  matches: ClubMatch[];
  /** true si los partidos salen de los resultados de liga (sin copas y quizá con fechas faltantes). */
  leagueOnly: boolean;
  standings: StandingTable[];
  strength: z.infer<typeof strengthSchema> | null;
  leaders: z.infer<typeof leaderSchema>[];
  squad: PlayerProfile[];
  next: NextMatch | null;
  values: MarketValue[];
  situation: Situation | null;
  /** Mediana de |real − esperado| / esperado en toda la liga: cuánto suele errar el modelo. */
  valueError: number | null;
  /** Valores de todos los clubes del país (para el Ojeador: oportunidades y jóvenes). */
  leagueValues: MarketValue[];
}

const median = (xs: number[]): number | null => {
  const s = xs.toSorted((a, b) => a - b);
  const lo = s[Math.floor((s.length - 1) / 2)];
  const hi = s[Math.ceil((s.length - 1) / 2)];
  return lo === undefined || hi === undefined ? null : (lo + hi) / 2;
};

type Strength = z.infer<typeof strengthSchema>;

/** Pronóstico del próximo partido con el GLM del predictor (la misma cuenta que la página Predictor). */
export function predictNext(
  fixtures: readonly z.infer<typeof fixtureSchema>[],
  strengths: readonly Strength[],
  metrics: z.infer<typeof predictorMetricsSchema> | null,
  isMine: (team: string) => boolean,
): NextMatch | null {
  const fixture = fixtures
    .toSorted((a, b) => a.match_date.localeCompare(b.match_date))
    .find((f) => isMine(f.home_team) || isMine(f.away_team));
  if (!fixture || !metrics) return null;
  const home = isMine(fixture.home_team);
  const opponent = home ? fixture.away_team : fixture.home_team;
  const league = strengths.filter((s) => s.competition === 'liga' && !s.estimated);
  const own = league.find((s) => isMine(s.team_name));
  const rival = league.find((s) => norm(s.team_name) === norm(opponent));
  if (!own || !rival) return null;
  const profile = (s: Strength): Profile => ({
    name: s.team_name,
    attackHome: s.attack_home ?? 1,
    attackAway: s.attack_away ?? 1,
    defenseHome: s.defense_home ?? 1,
    defenseAway: s.defense_away ?? 1,
    value: s.squad_value_eur ?? 1,
    elo: s.elo ?? metrics.league_elo ?? 1500,
    form: s.form ?? metrics.default_form ?? 1.35,
    estimated: false,
    count: 1,
  });
  const lam = lambdas(metrics.glm, profile(own), profile(rival), home ? 'local' : 'visitante');
  const { win, draw, loss } = outcomes(scoreMatrix(lam.own, lam.rival));
  return {
    date: fixture.match_date,
    stage: fixture.stage,
    home,
    opponent,
    win,
    draw,
    loss,
    goalsOwn: lam.own,
    goalsRival: lam.rival,
  };
}

async function fetchFile(path: string): Promise<Response> {
  const res = await fetch(BASE + path, { next: { revalidate: REVALIDATE_S } });
  if (!res.ok) throw new Error(`${path}: HTTP ${String(res.status)}`);
  return res;
}

async function readTable<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  const rows = await parquetReadObjects({ file: await (await fetchFile(path)).arrayBuffer(), compressors });
  return rows.map((r) => schema.parse(r));
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Las tablas de posiciones donde aparece el club (por nombre, nombre corto o alias), con su orden. */
export function standingsFor(rows: readonly StandingRow[], names: readonly string[]): StandingTable[] {
  const wanted = new Set(names.map(norm));
  const tables = new Map<string, StandingRow[]>();
  for (const r of rows) tables.set(r.table_name, [...(tables.get(r.table_name) ?? []), r]);
  return [...tables]
    .filter(([, t]) => t.some((r) => wanted.has(norm(r.team_name))))
    .map(([name, t]) => ({ name, rows: t.toSorted((a, b) => (a.rank ?? 99) - (b.rank ?? 99)) }));
}

/** Mismo id que `core.slug` en la base: `Unión de Santa Fe` → `union-de-santa-fe`. */
export const slug = (s: string) =>
  norm(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/** Partidos de liga de un club desde los resultados de toda la liga, desde su punto de vista. */
export function leagueMatchesFor(rows: readonly LeagueResult[], names: readonly string[]): ClubMatch[] {
  const wanted = new Set(names.map(norm));
  return rows.flatMap((r): ClubMatch[] => {
    const home = wanted.has(norm(r.home_team));
    if (!home && !wanted.has(norm(r.away_team))) return [];
    return [
      {
        id: r.ext_id ?? null,
        date: r.match_date,
        competition: r.stage,
        home,
        opponent: home ? r.away_team : r.home_team,
        goalsFor: home ? r.home_goals : r.away_goals,
        goalsAgainst: home ? r.away_goals : r.home_goals,
      },
    ];
  });
}

const fromTeamMatch = (m: z.infer<typeof teamMatchSchema>): ClubMatch => ({
  id: null,
  date: m.match_date,
  competition: [m.competition_name, m.round_label].filter(Boolean).join(' · ') || null,
  home: m.boca_home,
  opponent: m.opponent,
  goalsFor: m.goals_for,
  goalsAgainst: m.goals_against,
});

const failure = (cause: unknown): ArchiveResult<never> => ({
  ok: false,
  code: 'PEL-ARC-001',
  detail: cause instanceof Error ? cause.message : String(cause),
});

const getManifest = async () => manifestSchema.parse(await (await fetchFile('manifest.json')).json());

// shortcut: lee todas las temporadas y ligas del país juntas; con varias temporadas hay que elegir la última.
// Países y competiciones que lista el sistema (web/config/teams.ts), con su nombre para la web.
export const COUNTRIES: Record<string, string> = {
  ARG: 'Argentina',
  BRA: 'Brasil',
  URU: 'Uruguay',
  CHI: 'Chile',
  COL: 'Colombia',
  PAR: 'Paraguay',
  ECU: 'Ecuador',
  PER: 'Perú',
  BOL: 'Bolivia',
  VEN: 'Venezuela',
};
export const LEAGUE_NAMES: Record<string, string> = {
  'arg-liga-profesional-argentina': 'Primera División',
  'arg-primera-nacional': 'Primera Nacional',
  'arg-primera-b': 'Primera B',
  'arg-federal-a': 'Torneo Federal A',
  'bra-serie-a': 'Série A',
  'bra-serie-b': 'Série B',
  'uru-primera': 'Primera División',
  'chi-primera': 'Primera División',
  'col-primera-a': 'Primera A',
  'par-primera': 'Primera División',
  'ecu-serie-a': 'Serie A',
  'per-liga-1': 'Liga 1',
  'bol-primera': 'Primera División',
  'ven-primera': 'Liga FUTVE',
};
// Fuentes que permiten publicar sus datos (las demás solo dejan salir lo derivado).
const OPEN_SOURCES = new Set(['promiedos', 'wikipedia']);
const leagueOf = (path: string) => /liga=([^/]+)/.exec(path)?.[1] ?? null;
const clubSchema = z.object({ team_name: z.string() });

// shortcut: lee todas las temporadas y ligas del país juntas; con varias temporadas hay que elegir la última.
async function countryTables(country: string) {
  const manifest = await getManifest();
  const files = (tabla: string) =>
    manifest.archivos.filter((f) => f.tabla === tabla && f.ruta.startsWith(`pais=${country}/`)).map((f) => f.ruta);
  const tagged = <T>(tabla: string, schema: z.ZodType<T>) =>
    Promise.all(
      files(tabla).map(async (p) => (await readTable(p, schema)).map((r) => ({ row: r, league: leagueOf(p) }))),
    );
  const [results, standings, profiled] = await Promise.all([
    tagged('league_result', leagueResultSchema),
    tagged('league_standing', standingSchema),
    tagged('league_player_profile', clubSchema),
  ]);
  // Un club por liga: de su tabla, de sus partidos o de sus jugadores (países sin Promiedos).
  const clubs = new Map<string, { name: string; league: string | null }>();
  const add = (name: string, league: string | null) => {
    const key = `${league ?? ''}|${slug(name)}`;
    if (!clubs.has(key)) clubs.set(key, { name, league });
  };
  for (const { row, league } of standings.flat()) add(row.team_name, league);
  for (const { row, league } of results.flat()) {
    if (!OPEN_SOURCES.has(row.source)) continue;
    add(row.home_team, league);
    add(row.away_team, league);
  }
  for (const { row, league } of profiled.flat()) add(row.team_name, league);
  return {
    manifest,
    // Solo filas de fuentes abiertas: el archivo público ya no trae otras, pero la ficha cita a Promiedos.
    results: results
      .flat()
      .map((x) => ({ ...x.row, league: x.league }))
      .filter((r) => OPEN_SOURCES.has(r.source)),
    standings: standings.flat().map((x) => x.row),
    clubs: [...clubs.values()],
  };
}

/** Clubes con datos en un país, con su liga, ordenados por liga y nombre. */
export async function listClubs(country = 'ARG'): Promise<ArchiveResult<ClubLink[]>> {
  try {
    const { clubs } = await countryTables(country);
    const prefix = country.toLowerCase();
    // Dos grafías del mismo club («Unión» y «Union») dan el mismo id: queda una sola.
    const unique = new Map(clubs.map((c) => [`${prefix}-${slug(c.name)}`, c]));
    const data = [...unique].map(([uid, c]) => ({
      uid,
      name: c.name,
      league: c.league ? (LEAGUE_NAMES[c.league] ?? c.league) : null,
    }));
    return {
      ok: true,
      data: data.toSorted(
        (a, b) => (a.league ?? '').localeCompare(b.league ?? '', 'es') || a.name.localeCompare(b.name, 'es'),
      ),
    };
  } catch (cause) {
    return failure(cause);
  }
}

/** Ficha pública de un club por su id estable (`arg-boca-juniors`); null si no está en el archivo. */
export async function getClub(uid: string): Promise<ArchiveResult<Club | null>> {
  try {
    const country = uid.slice(0, 3).toUpperCase();
    const [{ manifest, results, standings, clubs }, identities] = await Promise.all([
      countryTables(country),
      readTable('referencia/team_identity.parquet', identitySchema),
    ]);
    const known = identities.find((t) => t.uid === uid);
    const found = known?.name ?? clubs.map((c) => c.name).find((n) => `${country.toLowerCase()}-${slug(n)}` === uid);
    if (found === undefined) return { ok: true, data: null };
    const aliases = known ? z.array(z.string()).parse(JSON.parse(known.aliases ?? '[]')) : [];
    const names = [found, known?.short_name ?? '', ...aliases].filter(Boolean);
    // Si el club tiene archivo propio (todas sus competiciones) se usa ese; si no, sus partidos de liga.
    const own = manifest.archivos.filter((f) => f.tabla === 'boca_match' && f.ruta.includes(`/equipo=${uid}/`));
    const inCountry = (tabla: string) =>
      manifest.archivos.filter((f) => f.tabla === tabla && f.ruta.startsWith(`pais=${country}/`)).map((f) => f.ruta);
    const [ownMatches, strengths, leaders, profiles, fixtures, runs, marketValues, situations] = await Promise.all([
      Promise.all(own.map((f) => readTable(f.ruta, teamMatchSchema))),
      Promise.all(inCountry('team_strength').map((p) => readTable(p, strengthSchema))),
      Promise.all(inCountry('league_leader').map((p) => readTable(p, leaderSchema))),
      Promise.all(inCountry('league_player_profile').map((p) => readTable(p, profileSchema))),
      Promise.all(inCountry('league_fixture').map((p) => readTable(p, fixtureSchema))),
      Promise.all(inCountry('model_run').map((p) => readTable(p, modelRunSchema))),
      Promise.all(inCountry('league_market_value').map((p) => readTable(p, marketValueSchema))),
      Promise.all(inCountry('league_situation').map((p) => readTable(p, situationSchema))),
    ]);
    const allValues = marketValues.flat();
    const predictor = runs.flat().find((r) => r.model === 'predictor_partido')?.metrics;
    const parsed = predictor ? predictorMetricsSchema.safeParse(JSON.parse(predictor)) : null;
    const matches = own.length ? ownMatches.flat().map(fromTeamMatch) : leagueMatchesFor(results, names);
    const wanted = new Set(names.map(norm));
    const mine = (team: string | null) => team !== null && wanted.has(norm(team));
    return {
      ok: true,
      data: {
        uid,
        name: found,
        country: known?.country ?? COUNTRIES[country] ?? null,
        matches: matches.toSorted((a, b) => a.date.localeCompare(b.date)),
        leagueOnly: own.length === 0,
        standings: standingsFor(standings, names),
        // La fuerza de liga medida (no la estimada para rivales de copa).
        strength: strengths.flat().find((s) => s.competition === 'liga' && !s.estimated && mine(s.team_name)) ?? null,
        leaders: leaders
          .flat()
          .filter((l) => OPEN_SOURCES.has(l.source) && mine(l.team_name))
          .toSorted((a, b) => a.stat.localeCompare(b.stat) || (a.rank ?? 99) - (b.rank ?? 99)),
        squad: profiles
          .flat()
          .filter((p) => mine(p.team_name))
          .toSorted((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0)),
        next: predictNext(fixtures.flat(), strengths.flat(), parsed?.success ? parsed.data : null, mine),
        values: allValues.filter((v) => mine(v.team_name)).toSorted((a, b) => (b.value_eur ?? 0) - (a.value_eur ?? 0)),
        situation: situations.flat().find((s) => mine(s.team_name)) ?? null,
        valueError: median(allValues.flatMap((v) => (v.gap_pct === null ? [] : [Math.abs(v.gap_pct)]))),
        leagueValues: allValues,
      },
    };
  } catch (cause) {
    return failure(cause);
  }
}

/** Estadísticas del perfil público, en orden de cancha. En pérdidas, percentil alto = pierde menos. */
export const PLAYER_STATS = [
  ['goals', 'Goles'],
  ['expected_goals', 'Goles esperados (xG)'],
  ['expected_assists', 'Asistencias esperadas (xA)'],
  ['key_pass', 'Pases clave'],
  ['accurate_pass', 'Pases completos'],
  ['progressive_ball_carries_count', 'Conducciones progresivas'],
  ['won_contest', 'Regates ganados'],
  ['won_tackle', 'Entradas ganadas'],
  ['interception', 'Intercepciones'],
  ['ball_recovery', 'Recuperaciones'],
  ['aerial_won', 'Duelos aéreos ganados'],
  ['duel_won', 'Duelos ganados'],
  ['saves', 'Atajadas'],
  ['goals_prevented', 'Goles evitados'],
  ['possession_lost', 'Pérdidas de balón'],
] as const;

export interface LeaguePlayer {
  club: { uid: string; name: string };
  league: string | null;
  player: PlayerProfile;
  /** Los de su misma liga y posición, para comparar. */
  peers: PlayerProfile[];
  versus: PlayerProfile | null;
}

async function countryProfiles(uid: string) {
  const manifest = await getManifest();
  const files = manifest.archivos.filter(
    (f) => f.tabla === 'league_player_profile' && f.ruta.startsWith(`pais=${uid.slice(0, 3).toUpperCase()}/`),
  );
  return (
    await Promise.all(
      files.map(async (f) => (await readTable(f.ruta, profileSchema)).map((p) => ({ p, league: leagueOf(f.ruta) }))),
    )
  ).flat();
}

/** Los jugadores con perfil de la liga de un club (para comparar con cualquiera de la liga). */
export async function getLeagueProfiles(uid: string): Promise<ArchiveResult<PlayerProfile[]>> {
  try {
    const club = await getClub(uid);
    if (!club.ok) return club;
    const ids = new Set(club.data?.squad.map((p) => p.player_id));
    const all = await countryProfiles(uid);
    const league = all.find((x) => ids.has(x.p.player_id))?.league;
    return {
      ok: true,
      data: all
        .filter((x) => league !== undefined && x.league === league)
        .map((x) => x.p)
        .toSorted(
          (a, b) => a.team_name.localeCompare(b.team_name, 'es') || a.player_name.localeCompare(b.player_name, 'es'),
        ),
    };
  } catch (cause) {
    return failure(cause);
  }
}

/** Ficha pública de un jugador de cualquier club por el id de su fuente; null si no está. */
export async function getLeaguePlayer(
  uid: string,
  playerId: string,
  versusId?: string,
): Promise<ArchiveResult<LeaguePlayer | null>> {
  try {
    const club = await getClub(uid);
    if (!club.ok) return club;
    const player = club.data?.squad.find((p) => p.player_id === playerId);
    if (!club.data || !player) return { ok: true, data: null };
    const all = await countryProfiles(uid);
    const league = all.find((x) => x.p.player_id === playerId)?.league ?? null;
    const peers = all
      .filter((x) => x.league === league && x.p.position === player.position && x.p.player_id !== playerId)
      .map((x) => x.p)
      .toSorted((a, b) => a.player_name.localeCompare(b.player_name, 'es'));
    return {
      ok: true,
      data: {
        club: { uid, name: club.data.name },
        league: league ? (LEAGUE_NAMES[league] ?? league) : null,
        player,
        peers,
        // Se puede comparar con cualquiera de la liga; la lista del formulario son los de su posición.
        versus: all.find((x) => x.league === league && x.p.player_id === versusId && versusId !== playerId)?.p ?? null,
      },
    };
  } catch (cause) {
    return failure(cause);
  }
}

const minutesSchema = z.array(z.number());
const goalMinutes = (json: string | null | undefined) => {
  const parsed = minutesSchema.safeParse(JSON.parse(json ?? '[]'));
  return parsed.success ? parsed.data : [];
};

export interface LeagueMatch {
  result: LeagueResult;
  league: string | null;
  home: { uid: string; name: string; standing: StandingRow | null };
  away: { uid: string; name: string; standing: StandingRow | null };
  /** Goles en orden de minuto; vacío si la fuente no da minutos o no cierran con el marcador. */
  goals: { minute: number; home: boolean }[];
  /** Los otros partidos entre los dos en el archivo, del más reciente al más viejo. */
  headToHead: LeagueResult[];
}

/** Ficha pública de un partido de liga por el id de su fuente; el país sale del club (`arg-…`). */
export async function getLeagueMatch(uid: string, matchId: string): Promise<ArchiveResult<LeagueMatch | null>> {
  try {
    const country = uid.slice(0, 3).toUpperCase();
    const { results, standings } = await countryTables(country);
    const result = results.find((r) => r.ext_id === matchId);
    if (!result) return { ok: true, data: null };
    const prefix = country.toLowerCase();
    const side = (name: string) => ({
      uid: `${prefix}-${slug(name)}`,
      name,
      // shortcut: la primera tabla con puntos donde figura (con zonas, la de su zona); la página muestra su nombre.
      standing: standings.find((s) => norm(s.team_name) === norm(name) && s.points !== null) ?? null,
    });
    const pair = new Set([norm(result.home_team), norm(result.away_team)]);
    const goals = [
      ...goalMinutes(result.home_goal_minutes).map((minute) => ({ minute, home: true })),
      ...goalMinutes(result.away_goal_minutes).map((minute) => ({ minute, home: false })),
    ].toSorted((a, b) => a.minute - b.minute);
    return {
      ok: true,
      data: {
        result,
        league: result.league ? (LEAGUE_NAMES[result.league] ?? result.league) : null,
        home: side(result.home_team),
        away: side(result.away_team),
        goals,
        headToHead: results
          .filter(
            (r) =>
              r !== result &&
              pair.has(norm(r.home_team)) &&
              pair.has(norm(r.away_team)) &&
              norm(r.home_team) !== norm(r.away_team),
          )
          .toSorted((a, b) => b.match_date.localeCompare(a.match_date)),
      },
    };
  } catch (cause) {
    return failure(cause);
  }
}
