'use client';

// Tabla ordenable de las interfaces de modelos, con el mismo ciclo que el resto del sistema
// (lib/stats/sort.ts): el primer clic en un encabezado elige la columna y muestra qué significa;
// los siguientes ordenan de menor a mayor, de mayor a menor y vuelven al orden original. Cada
// encabezado explica su columna al pasar el mouse. Una fila puede llevar a otra página.

import { CaretDownIcon } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState } from 'react';

import { nextSort, type SortState } from '@/lib/stats/sort';

export interface Column<T> {
  id: string;
  label: string;
  /** Qué significa la columna, en criollo (hover y barra de definición). */
  help?: string;
  /** Valor para ordenar; null va siempre al final. */
  value: (row: T) => number | string | null;
  render?: (row: T) => ReactNode;
  numeric?: boolean;
  /** Texto largo: se corta en varias líneas en vez de estirar la tabla. */
  wrap?: boolean;
}

const cellClass = (c: { numeric?: boolean; wrap?: boolean }) =>
  c.numeric ? 'tabular' : c.wrap ? 'cell-text cell-wrap' : 'cell-text';

interface Props<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Destino de cada fila: toda la fila lleva ahí (y la primera celda es el enlace accesible). */
  rowHref?: (row: T) => string | null;
  /** Fila resaltada (por ejemplo, el jugador elegido). */
  current?: (row: T) => boolean;
}

function compare(a: number | string | null, b: number | string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'es');
}

export function SortableTable<T>({ caption, columns, rows, rowKey, rowHref, current }: Props<T>) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState | null>(null);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.id === sort?.id);
    if (!sort || !col) return rows;
    return rows.toSorted((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === null || vb === null) return compare(va, vb); // los vacíos, al final en los dos sentidos
      return sort.dir === 'asc' ? compare(va, vb) : compare(vb, va);
    });
  }, [rows, columns, sort]);
  const chosen = columns.find((c) => c.id === selected);

  return (
    <div className="grid gap-2">
      {chosen?.help ? (
        <p className="sort-definition" aria-live="polite">
          <strong>{chosen.label}:</strong> {chosen.help}
          {sort?.id === chosen.id ? (sort.dir === 'asc' ? ' · de menor a mayor' : ' · de mayor a menor') : null}
        </p>
      ) : null}
      <div className="data-table-wrap">
        <table className="data-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const on = sort?.id === c.id;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    title={c.help ?? c.label}
                    className={cellClass(c)}
                    data-current-stat={selected === c.id || undefined}
                    aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button
                      type="button"
                      className="sort-button focus-ring"
                      onClick={() => {
                        const next = nextSort(sort, c.id, selected);
                        setSelected(next.selected);
                        setSort(next.sort);
                      }}
                    >
                      {c.label}
                      {on ? (
                        <CaretDownIcon
                          size={12}
                          weight="bold"
                          className="sort-arrow"
                          data-dir={sort.dir}
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const href = rowHref?.(row) ?? null;
              return (
                <tr
                  key={rowKey(row)}
                  data-link={href ? true : undefined}
                  aria-current={current?.(row) || undefined}
                  onClick={
                    href
                      ? (e) => {
                          // El clic en el enlace ya navega; el resto de la fila hace lo mismo.
                          if (!(e.target as HTMLElement).closest('a')) router.push(href);
                        }
                      : undefined
                  }
                >
                  {columns.map((c, i) => {
                    const content = c.render ? c.render(row) : (c.value(row) ?? 'n/d');
                    const cell =
                      i === 0 && href ? (
                        <Link href={href} className="row-link focus-ring">
                          {content}
                        </Link>
                      ) : (
                        content
                      );
                    return i === 0 ? (
                      <th key={c.id} scope="row" className={cellClass(c)}>
                        {cell}
                      </th>
                    ) : (
                      <td key={c.id} className={cellClass(c)}>
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
