'use client';

import { ArrowSquareOutIcon, DownloadSimpleIcon, ImageIcon, TableIcon, WarningCircleIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { formatValue } from './primitives';

export interface ChartTable {
  head: string[];
  rows: (string | number | null)[][];
}

interface ChartCardProps {
  id: string;
  number: string;
  title: string;
  source: string;
  updated: string | null;
  coverage?: string;
  origin?: string;
  /** Tooltip del botón de origen, por ejemplo «Origen: Equipo › Ataque». */
  originLabel?: string;
  /** Estadística desglosada (9.8): se abre con doble clic sobre el gráfico o con el enlace. */
  detailHref?: string;
  table?: ChartTable;
  empty?: string;
  children?: ReactNode;
}

/** Una celda de texto que empieza con = + - @ se escribe con un apóstrofo: no se ejecuta como fórmula (14.3). */
function csvCell(v: string | number | null): string {
  if (v === null) return '';
  if (typeof v === 'number') return String(v).replace('.', ',');
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** PNG del gráfico: copia los estilos ya resueltos (colores de las variables CSS) al SVG. */
export async function downloadPng(svg: SVGSVGElement, name: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const from = svg.querySelectorAll('*');
  const to = clone.querySelectorAll('*');
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    to[i]?.setAttribute(
      'style',
      `fill:${cs.fill};stroke:${cs.stroke};stroke-width:${cs.strokeWidth};opacity:${cs.opacity};fill-opacity:${cs.fillOpacity};font:${cs.font}`,
    );
  });
  const [, , w = 560, h = 240] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
  const scale = 2;
  clone.setAttribute('width', String(w * scale));
  clone.setAttribute('height', String(h * scale));
  const background = getComputedStyle(svg.closest('.chart-card') ?? svg).backgroundColor;
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(img.src);
  canvas.toBlob((blob) => {
    if (blob) download(blob, `${name}.png`);
  });
}

/**
 * Tarjeta de un gráfico de la landing (9.2): número del catálogo, título, fuente, fecha de
 * actualización, cobertura, tabla equivalente (botón «Ver como tabla», también para lectores de
 * pantalla; no se repite oculta en cada tarjeta para no multiplicar el DOM), descarga en PNG
 * y CSV y «Ver origen de los datos» (9.9). Sin datos, queda la tarjeta con el motivo.
 */
export function ChartCard({
  id,
  number,
  title,
  source,
  updated,
  coverage,
  origin,
  originLabel,
  detailHref,
  table,
  empty,
  children,
}: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const router = useRouter();
  // Doble clic (o doble toque) sobre el gráfico: la estadística desglosada. Con el teclado, el
  // enlace «Desglosada» del pie hace lo mismo.
  useEffect(() => {
    const el = ref.current;
    if (!el || !detailHref || empty) return;
    const open = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, a, select')) return;
      router.push(detailHref);
    };
    el.addEventListener('dblclick', open);
    return () => {
      el.removeEventListener('dblclick', open);
    };
  }, [detailHref, empty, router]);
  // Rendimiento (10.2): la landing tiene ~100 gráficos. Cada uno se monta recién cuando su tarjeta
  // está a 800 px de entrar en pantalla (o al imprimir); antes, un espacio reservado del mismo alto.
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || empty) return;
    const show = () => {
      setNear(true);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          show();
          observer.disconnect();
        }
      },
      { rootMargin: '800px 0px' },
    );
    observer.observe(el);
    window.addEventListener('beforeprint', show);
    return () => {
      observer.disconnect();
      window.removeEventListener('beforeprint', show);
    };
  }, [empty]);
  const name = `pelotheta-${id}`;
  return (
    <article ref={ref} className={`chart-card${empty ? ' chart-card--empty' : ''}`} aria-labelledby={`${id}-title`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tabular text-xs text-muted">Gráfico {number}</p>
          <h3 id={`${id}-title`} className="text-base font-bold leading-snug">
            {title}
          </h3>
        </div>
        {!empty ? (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              className="icon-button focus-ring"
              aria-pressed={showTable}
              title="Ver como tabla"
              onClick={() => {
                setShowTable((v) => !v);
              }}
            >
              <TableIcon size={16} aria-hidden="true" />
              <span className="sr-only">Ver como tabla</span>
            </button>
            <button
              type="button"
              className="icon-button focus-ring"
              title="Descargar PNG"
              onClick={() => {
                const svg = ref.current?.querySelector('svg.chart-svg');
                if (svg instanceof SVGSVGElement) void downloadPng(svg, name);
              }}
            >
              <ImageIcon size={16} aria-hidden="true" />
              <span className="sr-only">Descargar PNG</span>
            </button>
            {table ? (
              <button
                type="button"
                className="icon-button focus-ring"
                title="Descargar los datos (CSV)"
                onClick={() => {
                  const lines = [table.head, ...table.rows].map((r) => r.map(csvCell).join(';'));
                  download(new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
                }}
              >
                <DownloadSimpleIcon size={16} aria-hidden="true" />
                <span className="sr-only">Descargar los datos</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {empty ? (
        <p className="flex items-start gap-2 text-sm text-muted">
          <WarningCircleIcon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            <span className="font-bold text-fg">Sin datos.</span> {empty}
          </span>
        </p>
      ) : showTable && table ? (
        <div className="max-h-72 overflow-auto">
          <ChartDataTable table={table} title={title} />
        </div>
      ) : near ? (
        children
      ) : (
        <div className="chart-placeholder" aria-hidden="true" />
      )}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Fuente: {source}
          {updated ? ` · actualizado ${updated}` : ''}
          {coverage ? ` · ${coverage}` : ''}
        </span>
        {detailHref && !empty ? (
          <Link
            href={detailHref}
            className="inline-flex items-center gap-1 font-semibold text-link focus-ring"
            title="También con doble clic sobre el gráfico"
          >
            Desglosada
          </Link>
        ) : null}
        {origin && !empty ? (
          <Link
            href={origin}
            title={originLabel}
            className="inline-flex items-center gap-1 font-semibold text-link focus-ring"
          >
            Ver origen de los datos <ArrowSquareOutIcon size={12} aria-hidden="true" />
          </Link>
        ) : null}
      </footer>
    </article>
  );
}

function ChartDataTable({ table, title }: { table: ChartTable; title: string }) {
  return (
    <table className="chart-table">
      <caption className="sr-only">Datos de: {title}</caption>
      <thead>
        <tr>
          {table.head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{typeof c === 'number' ? formatValue(c) : (c ?? 'n/d')}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
