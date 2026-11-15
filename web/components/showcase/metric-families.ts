// Las 24 métricas propias (docs/metricas_propias.md) agrupadas por familia. Una sola lista para el
// diagrama del pipeline y para la sección de métricas, así el total siempre coincide.

export interface Metric {
  /** Abreviatura de dos a cuatro letras. */
  symbol: string;
  name: string;
}

export interface MetricFamily {
  slug: string;
  name: string;
  scope: 'Equipo' | 'Jugador';
  metrics: readonly Metric[];
}

export const FAMILIES: readonly MetricFamily[] = [
  {
    slug: 'fuerza',
    name: 'Fuerza',
    scope: 'Equipo',
    metrics: [
      { symbol: 'Elo', name: 'Elo propio' },
      { symbol: 'Pp', name: 'Probabilidad previa' },
      { symbol: 'So', name: 'Sorpresa' },
      { symbol: 'Br', name: 'Brier' },
    ],
  },
  {
    slug: 'esperado',
    name: 'Rendimiento esperado',
    scope: 'Equipo',
    metrics: [
      { symbol: 'xPts', name: 'Puntos esperados' },
      { symbol: 'ΔPts', name: 'Puntos − xPts' },
      { symbol: 'Pit', name: 'Pitagórico' },
      { symbol: 'P⅓', name: 'Puntos por tercio' },
    ],
  },
  {
    slug: 'forma',
    name: 'Estado de forma',
    scope: 'Equipo',
    metrics: [
      { symbol: 'Ra', name: 'Rachas' },
      { symbol: 'Fo', name: 'Forma' },
      { symbol: 'Co', name: 'Consistencia' },
    ],
  },
  {
    slug: 'once',
    name: 'Once',
    scope: 'Equipo',
    metrics: [
      { symbol: 'Ro', name: 'Rotación' },
      { symbol: 'Es', name: 'Estabilidad del once' },
      { symbol: 'Cg', name: 'Concentración de goles' },
    ],
  },
  {
    slug: 'jugador',
    name: 'Jugador en cancha',
    scope: 'Jugador',
    metrics: [
      { symbol: 'NR', name: 'Diferencia de gol en cancha' },
      { symbol: 'NRr', name: 'NR relativo' },
      { symbol: 'EWA', name: 'Victorias que suma' },
      { symbol: 'ELA', name: 'Derrotas que suma' },
      { symbol: 'NRx', name: 'NR con xG' },
    ],
  },
  {
    slug: 'proyeccion',
    name: 'Mejoría y Potencial',
    scope: 'Jugador',
    metrics: [
      { symbol: 'IR', name: 'Índice de rendimiento' },
      { symbol: 'Mα', name: 'Mejoría α' },
      { symbol: 'Mβ', name: 'Mejoría β' },
      { symbol: 'Pα', name: 'Potencial α' },
      { symbol: 'Pβ', name: 'Potencial β' },
    ],
  },
];

export const METRIC_TOTAL = FAMILIES.reduce((sum, family) => sum + family.metrics.length, 0);
