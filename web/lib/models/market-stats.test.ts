import { describe, expect, it } from 'vitest';

import { marketStats } from './market-stats';
import type { MarketPlayer, SquadPlayer } from './scouting';

const GROUPS = ['Arquero', 'Defensor', 'Mediocampista', 'Delantero'];

// Delanteros cuatro veces más caros y precio con pico a los 27 años.
const market: MarketPlayer[] = Array.from({ length: 200 }, (_, i) => {
  const position = GROUPS[i % 4] as string;
  const age = 18 + (i % 17);
  const base = 1e6 * Math.exp(-((age - 27) ** 2) / 40) * (position === 'Delantero' ? 4 : 1);
  return {
    name: `M${String(i)}`,
    team: 'Otro',
    position,
    age,
    value: base * (1 + (i % 5) / 10),
    minutes: null,
    stats: {},
  };
});
const squad: SquadPlayer[] = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  name: `J${String(i)}`,
  position: 'Defensor',
  age: 20 + i,
  minutes: 1000,
  contractYears: 2,
  value: 5e6,
  stats: {},
}));

describe('estadística del mercado', () => {
  it('detecta el efecto del puesto, el pico de edad y la diferencia del plantel', () => {
    const s = marketStats(market, squad);
    expect(s).not.toBeNull();
    expect(s?.anova.p).toBeLessThan(0.05);
    expect(s?.regression.beta[2]).toBeLessThan(0);
    expect(s?.regression.r2).toBeGreaterThan(s?.simpleR2 ?? 1);
    expect(s?.curves).toHaveLength(4);
    expect(s?.comparisons.find((c) => c.id === 'medias')?.reject).toBe(true);
    expect(s?.contingency.df).toBe(9);
  });

  it('sin jugadores suficientes por puesto no analiza', () => {
    expect(marketStats(market.slice(0, 10), squad)).toBeNull();
  });
});
