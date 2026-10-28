// Orden de las tablas (pedido del dueño, 28-oct): el primer clic en un encabezado solo elige la
// estadística, para poder leer su definición en el panel sin que la tabla se mueva. Los clics
// siguientes sobre la misma columna ordenan de menor a mayor, de mayor a menor y vuelven al
// orden original.

export type SortDir = 'asc' | 'desc';
export interface SortState {
  id: string;
  dir: SortDir;
}

export function nextSort(
  sort: SortState | null,
  clicked: string,
  selected: string | null,
): { selected: string; sort: SortState | null } {
  if (clicked !== selected) return { selected: clicked, sort };
  if (sort?.id !== clicked) return { selected: clicked, sort: { id: clicked, dir: 'asc' } };
  return { selected: clicked, sort: sort.dir === 'asc' ? { id: clicked, dir: 'desc' } : null };
}
