// Estadística desglosada (9.8): cálculos chicos del lado de la web, puros y testeados.

/**
 * Racha actual: cuántos partidos seguidos, contando desde el último, quedaron del mismo lado
 * del promedio. Los n/d se saltean; un valor igual al promedio corta la racha.
 */
export function currentStreak(
  values: readonly (number | null)[],
  mean: number,
): { count: number; above: boolean } | null {
  const known = values.filter((v): v is number => v !== null);
  const last = known.at(-1);
  if (last === undefined || last === mean) return null;
  const above = last > mean;
  let count = 0;
  for (let i = known.length - 1; i >= 0; i--) {
    const v = known[i] ?? mean;
    if (v === mean || v > mean !== above) break;
    count += 1;
  }
  return { count, above };
}
