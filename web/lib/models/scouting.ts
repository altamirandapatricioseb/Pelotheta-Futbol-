// Ojeador: lee el plantel (minutos, estadísticas, edad, contrato) y el mercado de la liga (valor, edad,
// posición y, cuando la fuente las trae, estadísticas) y arma informes de fichaje con nota.
// Todo se calcula en el momento con lo que haya cargado: sirve igual para cualquier equipo nuevo, y
// en cuanto `player_pool.stats` tenga estadísticas de otros clubes, la referencia pasa a ser la liga.

export const GROUPS = ['Arquero', 'Defensor', 'Mediocampista', 'Delantero'] as const;
export type Group = (typeof GROUPS)[number];

/** Plantel ideal por puesto y titulares que juegan. shortcut: fijo para un 4-3-3, pasarlo por equipo si hace falta. */
const TARGET: Record<Group, number> = { Arquero: 3, Defensor: 8, Mediocampista: 8, Delantero: 5 };
const STARTERS: Record<Group, number> = { Arquero: 1, Defensor: 4, Mediocampista: 3, Delantero: 3 };
/** Edad desde la que el titular cuenta como riesgo: los arqueros duran más. */
const OLD: Record<Group, number> = { Arquero: 35, Defensor: 32, Mediocampista: 32, Delantero: 31 };
const MIN_SQUAD = 300;
const MIN_LEAGUE = 450;
const MIN_LEAGUE_PEERS = 8;

export interface StatDef {
  id: string;
  label: string;
  per90: boolean;
  lowerBetter?: boolean;
}

const c = (id: string, label: string, lowerBetter = false): StatDef => ({ id, label, per90: true, lowerBetter });
const r = (id: string, label: string): StatDef => ({ id, label, per90: false });

/** Estadísticas que importan en cada puesto (claves de `stats`, totales de temporada). */
export const POSITION_STATS: Record<Group, StatDef[]> = {
  Arquero: [
    c('goles_recibidos', 'Goles recibidos', true),
    c('vallas_invictas', 'Vallas invictas'),
    c('atajadas_dentro_area', 'Atajadas en el área'),
    c('salidas_exitosas', 'Salidas'),
    c('centros_atrapados', 'Centros atrapados'),
    r('pct_pases', '% pases'),
    c('errores_gol', 'Errores en gol', true),
    r('calificacion', 'Calificación'),
  ],
  Defensor: [
    c('entradas_ganadas', 'Entradas ganadas'),
    c('intercepciones', 'Intercepciones'),
    c('despejes', 'Despejes'),
    c('aereos_ganados', 'Aéreos ganados'),
    r('pct_duelos', '% duelos'),
    c('veces_regateado', 'Veces regateado', true),
    r('pct_pases', '% pases'),
    c('conducciones_progresivas', 'Conducciones progresivas'),
    r('calificacion', 'Calificación'),
  ],
  Mediocampista: [
    c('pases', 'Pases'),
    r('pct_pases', '% pases'),
    c('pases_clave', 'Pases clave'),
    c('pases_campo_rival_completos', 'Pases en campo rival'),
    c('conducciones_progresivas', 'Conducciones progresivas'),
    c('recuperaciones', 'Recuperaciones'),
    c('entradas_ganadas', 'Entradas ganadas'),
    c('xa', 'xA'),
    r('calificacion', 'Calificación'),
  ],
  Delantero: [
    c('goles_sin_penal', 'Goles sin penal'),
    c('npxg', 'npxG'),
    c('remates_arco', 'Remates al arco'),
    c('xa', 'xA'),
    c('pases_clave', 'Pases clave'),
    c('regates_exitosos', 'Regates'),
    c('aereos_ganados', 'Aéreos ganados'),
    c('ocasiones_claras_falladas', 'Ocasiones claras falladas', true),
    r('calificacion', 'Calificación'),
  ],
};

export interface SquadPlayer {
  id: number;
  name: string;
  position: string | null;
  age: number | null;
  minutes: number;
  contractYears: number | null;
  value: number | null;
  stats: Record<string, number>;
}

export interface MarketPlayer {
  name: string;
  team: string;
  position: string | null;
  age: number | null;
  value: number | null;
  minutes: number | null;
  stats: Record<string, number>;
}

/** Contra quién se mide cada percentil: la liga si hay estadísticas de otros clubes, si no el plantel. */
export type Reference = 'liga' | 'plantel';

export interface StatScore {
  id: string;
  label: string;
  value: number;
  /** 0 a 100 contra la referencia (ya invertido donde menos es mejor). */
  percentile: number;
}

export interface NeedPlayer extends SquadPlayer {
  regular: boolean;
  scores: StatScore[];
}

export interface Need {
  group: Group;
  /** 0 a 10: cuánto hace falta reforzar el puesto. */
  score: number;
  regulars: number;
  target: number;
  reference: Reference;
  /** Percentil medio de los titulares en cada estadística del puesto, de la peor a la mejor. */
  weakStats: StatScore[];
  averageAge: number | null;
  budget: number | null;
  reasons: string[];
  players: NeedPlayer[];
}

export type Category = 'necesidad' | 'oportunidad' | 'promesa';
export type Verdict = 'Fichar' | 'Seguir de cerca' | 'Opción de reserva';

export interface Report {
  id: string;
  player: MarketPlayer;
  group: Group;
  category: Category;
  /** 0 a 10. */
  score: number;
  verdict: Verdict;
  /** 0 a 100. */
  ability: number;
  potential: number;
  expectedValue: number | null;
  /** Percentiles del puesto contra la liga (vacío mientras no haya estadísticas de ese jugador). */
  scores: StatScore[];
  strengths: StatScore[];
  pros: string[];
  cons: string[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
const isGroup = (p: string | null): p is Group => GROUPS.includes(p as Group);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** Percentil 0 a 100 de x en la lista (empates a la mitad). */
function percentile(xs: number[], x: number): number {
  if (xs.length < 2) return 50;
  const below = xs.filter((v) => v < x).length;
  const equal = xs.filter((v) => v === x).length;
  return Math.round((100 * (below + (equal - 1) / 2)) / (xs.length - 1));
}

/** Valor de una estadística (cada 90 si corresponde) o null si falta o hay pocos minutos. */
export function statValue(stats: Record<string, number>, minutes: number | null, def: StatDef): number | null {
  const v = stats[def.id];
  if (v === undefined || !Number.isFinite(v)) return null;
  if (!def.per90) return v;
  return minutes && minutes > 0 ? (v / minutes) * 90 : null;
}

interface Sample {
  stats: Record<string, number>;
  minutes: number | null;
}

/** Distribución de cada estadística del puesto en una muestra. */
function distributions(sample: Sample[], defs: StatDef[]): Map<string, number[]> {
  return new Map(
    defs.map((d) => [d.id, sample.flatMap((p) => {
      const v = statValue(p.stats, p.minutes, d);
      return v === null ? [] : [v];
    })]),
  );
}

function scoresOf(p: Sample, defs: StatDef[], dist: Map<string, number[]>): StatScore[] {
  return defs.flatMap((d) => {
    const v = statValue(p.stats, p.minutes, d);
    const xs = dist.get(d.id) ?? [];
    if (v === null || xs.length < 2) return [];
    const pct = percentile(xs, v);
    return [{ id: d.id, label: d.label, value: v, percentile: d.lowerBetter ? 100 - pct : pct }];
  });
}

const leagueSample = (market: MarketPlayer[], group: Group) =>
  market.filter((p) => p.position === group && (p.minutes ?? 0) >= MIN_LEAGUE && Object.keys(p.stats).length > 0);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Necesidad de cada puesto: profundidad, estadísticas del puesto, edad y contratos. */
export function teamNeeds(squad: SquadPlayer[], market: MarketPlayer[] = []): Need[] {
  const maxMinutes = Math.max(0, ...squad.map((p) => p.minutes));
  const isRegular = (p: SquadPlayer) => p.minutes > 0 && p.minutes >= 0.15 * maxMinutes;
  return GROUPS.map((group) => {
    const defs = POSITION_STATS[group];
    const players = squad.filter((p) => p.position === group).sort((a, b) => b.minutes - a.minutes);
    const league = leagueSample(market, group);
    const reference: Reference = league.length >= MIN_LEAGUE_PEERS ? 'liga' : 'plantel';
    const own = players.filter((p) => p.minutes >= MIN_SQUAD);
    const dist = distributions(reference === 'liga' ? league : own, defs);
    const rows: NeedPlayer[] = players.map((p) => ({
      ...p,
      regular: isRegular(p),
      scores: p.minutes >= MIN_SQUAD ? scoresOf(p, defs, dist) : [],
    }));
    const regulars = rows.filter((p) => p.regular);
    const starters = rows.slice(0, STARTERS[group]);
    // Los que no son habituales suman medio lugar: un cuarto arquero sí cuenta como profundidad.
    const depth = regulars.length + 0.5 * (rows.length - regulars.length);
    const depthGap = clamp01(1 - depth / TARGET[group]);
    // Percentil medio de los titulares por estadística, de la peor a la mejor (contra la referencia).
    const weakStats = defs
      .flatMap((d) => {
        const ps = starters.flatMap((p) => p.scores.filter((s) => s.id === d.id));
        const m = mean(ps.map((s) => s.percentile));
        return m === null ? [] : [{ id: d.id, label: d.label, value: mean(ps.map((s) => s.value)) ?? 0, percentile: Math.round(m) }];
      })
      .sort((a, b) => a.percentile - b.percentile);
    // Nivel contra la liga: cuánto le falta a la media de percentiles de los titulares para llegar a 65.
    const starterLevel = reference === 'liga' ? mean(weakStats.map((s) => s.percentile)) : null;
    const levelGap = starterLevel === null ? 0 : clamp01((65 - starterLevel) / 40);
    const old = starters.filter((p) => (p.age ?? 0) >= OLD[group]);
    const leaving = starters.filter((p) => p.contractYears !== null && p.contractYears <= 1);
    const ageRisk = starters.length ? old.length / starters.length : 1;
    const contractRisk = starters.length ? leaving.length / starters.length : 1;
    const raw =
      reference === 'liga'
        ? 0.3 * depthGap + 0.35 * levelGap + 0.2 * ageRisk + 0.15 * contractRisk
        : (0.3 * depthGap + 0.2 * ageRisk + 0.15 * contractRisk) / 0.65;
    const ages = regulars.flatMap((p) => (p.age === null ? [] : [p.age]));
    const m = median(starters.flatMap((p) => (p.value === null ? [] : [p.value])));
    const reasons: string[] = [];
    if (depthGap > 0)
      reasons.push(`${String(regulars.length)} habituales y ${String(rows.length - regulars.length)} más para ${String(TARGET[group])} lugares`);
    const weak = weakStats.filter((s) => s.percentile < 40).slice(0, 3);
    if (weak.length && reference === 'liga')
      reasons.push(`Titulares flojos contra la liga en ${weak.map((s) => `${s.label} (p${String(s.percentile)})`).join(', ')}`);
    if (old.length) reasons.push(`${old.map((p) => p.name).join(', ')}: ${String(OLD[group])} años o más`);
    if (leaving.length) reasons.push(`Contrato de un año o menos: ${leaving.map((p) => p.name).join(', ')}`);
    if (!reasons.length) reasons.push('Puesto cubierto: alcanza con oportunidades claras');
    return {
      group,
      score: round1(10 * clamp01(raw)),
      regulars: regulars.length,
      target: TARGET[group],
      reference,
      weakStats,
      averageAge: mean(ages),
      budget: m === null ? null : m * 1.5,
      reasons,
      players: rows,
    };
  }).sort((a, b) => b.score - a.score);
}

const verdictOf = (score: number): Verdict => (score >= 7.5 ? 'Fichar' : score >= 6 ? 'Seguir de cerca' : 'Opción de reserva');

function ageUpside(age: number | null): number {
  if (age === null) return 0;
  return age <= 19 ? 0.2 : age <= 21 ? 0.14 : age <= 23 ? 0.08 : age <= 26 ? 0.03 : age >= 30 ? -0.05 : 0;
}

/**
 * Informes de los jugadores del mercado en las tres categorías. Nivel: valor de mercado contra el de
 * los titulares propios del puesto, en escala logarítmica (relativo al equipo, como en Football Manager),
 * promediado con la media de percentiles de sus estadísticas cuando la fuente las trae.
 */
export function scoutReports(market: MarketPlayer[], needs: Need[], perCategory = 12): Report[] {
  const needOf = new Map(needs.map((n) => [n.group, n]));
  const valued = market.filter((p) => isGroup(p.position) && p.value !== null && p.value > 0);
  const leagueMedian = median(valued.map((p) => p.value as number));
  const perGroup = new Map(
    GROUPS.map((g) => {
      const peers = valued.filter((p) => p.position === g);
      const league = leagueSample(market, g);
      return [g, { peers, dist: distributions(league, POSITION_STATS[g]), rated: league.length >= MIN_LEAGUE_PEERS }];
    }),
  );

  const base = valued.map((p) => {
    const group = p.position as Group;
    const g = perGroup.get(group);
    const peers = g?.peers ?? [];
    // Como las estrellas de Football Manager, relativo al propio plantel: 50 = vale lo mismo que los
    // titulares del puesto, 75 = el doble, 100 = cuatro veces, 25 = la mitad.
    const need0 = needOf.get(group);
    const ref = need0?.budget ? need0.budget / 1.5 : leagueMedian;
    const market01 = ref ? clamp01(0.5 + 0.25 * Math.log2((p.value as number) / ref)) : 0.5;
    const scores = g?.rated && (p.minutes ?? 0) >= MIN_LEAGUE ? scoresOf(p, POSITION_STATS[group], g.dist) : [];
    const statLevel = mean(scores.map((s) => s.percentile));
    const ability = statLevel === null ? market01 : 0.4 * market01 + 0.6 * (statLevel / 100);
    const potential = clamp01(ability + ageUpside(p.age));
    const sameAge = peers.filter((q) => p.age !== null && q.age !== null && Math.abs(q.age - p.age) <= 2);
    const expectedValue = median((sameAge.length >= 5 ? sameAge : peers).map((q) => q.value as number));
    const ratio = expectedValue ? (p.value as number) / expectedValue : 1;
    const need = needOf.get(group);
    const budget = need?.budget ?? (leagueMedian === null ? null : leagueMedian * 2);
    const affordable = budget === null ? 0.5 : clamp01(budget / (p.value as number));
    // Encaje: si el puesto tiene estadísticas flojas, suma ser bueno justo en esas.
    const weakIds = new Set((need?.reference === 'liga' ? need.weakStats : []).filter((s) => s.percentile < 40).map((s) => s.id));
    const covers = scores.filter((s) => weakIds.has(s.id) && s.percentile >= 60);
    return { p, group, ability, potential, ratio, expectedValue, need: (need?.score ?? 5) / 10, budget, affordable, scores, covers };
  });

  const build = (b: (typeof base)[number], category: Category, raw: number): Report => {
    const pros: string[] = [];
    const cons: string[] = [];
    const strengths = [...b.scores].sort((x, y) => y.percentile - x.percentile).filter((s) => s.percentile >= 70).slice(0, 3);
    if (strengths.length) pros.push(`Fuerte en ${strengths.map((s) => `${s.label} (p${String(s.percentile)})`).join(', ')}`);
    if (b.covers.length) pros.push(`Cubre lo que le falta al puesto: ${b.covers.map((s) => s.label).join(', ')}`);
    if (b.ratio <= 0.7) pros.push(`Cuesta ${String(Math.round((1 - b.ratio) * 100))} % menos que la mediana de su puesto y edad`);
    if (b.potential - b.ability >= 0.12) pros.push(`Margen de crecimiento: ${String(b.p.age)} años`);
    if (b.need >= 0.6) pros.push(`Puesto con necesidad alta en el plantel (${String(round1(b.need * 10))})`);
    const weakest = [...b.scores].sort((x, y) => x.percentile - y.percentile).filter((s) => s.percentile <= 25).slice(0, 2);
    if (weakest.length) cons.push(`Flojo en ${weakest.map((s) => `${s.label} (p${String(s.percentile)})`).join(', ')}`);
    if (b.ratio >= 1.6) cons.push(`Cuesta ${b.ratio.toFixed(1).replace('.', ',')} veces la mediana de su puesto y edad`);
    if (b.affordable < 1 && b.budget !== null) cons.push('Por encima del presupuesto estimado para el puesto');
    if ((b.p.age ?? 0) >= 30) cons.push('Poca reventa: 30 años o más');
    if (!b.scores.length) cons.push('Sin estadísticas cargadas: la nota se apoya en el mercado');
    const score = round1(10 * clamp01(raw));
    return {
      id: `${b.p.name}|${b.p.team}`,
      player: b.p,
      group: b.group,
      category,
      score,
      verdict: verdictOf(score),
      ability: Math.round(100 * b.ability),
      potential: Math.round(100 * b.potential),
      expectedValue: b.expectedValue,
      scores: b.scores,
      strengths,
      pros,
      cons,
    };
  };

  const top = (items: Report[]) => items.sort((a, b) => b.score - a.score).slice(0, perCategory);
  const cheap = (x: number) => clamp01(1 - x / 2);
  const fitBonus = (b: (typeof base)[number]) => Math.min(0.1, 0.05 * b.covers.length);
  const fit = (b: (typeof base)[number]) =>
    0.35 * b.need + 0.3 * b.potential + 0.2 * b.ability + 0.15 * b.affordable + fitBonus(b);

  // Necesidad: los mejores por puesto, repartidos según cuánto falta en cada uno.
  const needReports = needs.flatMap((n) => {
    const slots = Math.max(1, Math.round((n.score / 10) * 5));
    return top(base.filter((b) => b.group === n.group).map((b) => build(b, 'necesidad', fit(b)))).slice(0, slots);
  });
  const opportunities = top(
    base
      .filter((b) => b.ratio < 1)
      .map((b) => build(b, 'oportunidad', 0.45 * b.ability + 0.35 * cheap(b.ratio) + 0.2 * b.need + fitBonus(b))),
  );
  const prospects = top(
    base
      .filter((b) => b.p.age !== null && b.p.age <= 21)
      .map((b) => build(b, 'promesa', 0.55 * b.potential + 0.25 * b.ability + 0.2 * b.need)),
  );
  return [...needReports, ...opportunities, ...prospects];
}
