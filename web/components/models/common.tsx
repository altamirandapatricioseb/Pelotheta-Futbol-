import { HourglassIcon, InfoIcon } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';

// Piezas compartidas de las interfaces de modelos: título, números destacados y el aviso «sin datos».

const INT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const DEC2 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const DEC3 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3, minimumFractionDigits: 3 });

export const eur = (v: number | null | undefined) =>
  v === null || v === undefined ? 'n/d' : v >= 1e6 ? `€ ${DEC2.format(v / 1e6)} M` : `€ ${INT.format(v)}`;
export const pct = (v: number | null | undefined, decimals = 0) =>
  v === null || v === undefined ? 'n/d' : `${(v * 100).toFixed(decimals).replace('.', ',')} %`;
export const dec2 = (v: number | null | undefined) => (v === null || v === undefined ? 'n/d' : DEC2.format(v));
export const dec3 = (v: number | null | undefined) => (v === null || v === undefined ? 'n/d' : DEC3.format(v));
/** p-valor legible: debajo de 0,001 no se muestran más ceros. */
export const pValue = (p: number | null | undefined) =>
  p === null || p === undefined ? 'n/d' : p < 0.001 ? '< 0,001' : DEC3.format(p);
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function ModelHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="page-title">
        <span className="title-trace">{title}</span>
      </h1>
      <p className="mt-2 text-muted">{subtitle}</p>
    </div>
  );
}

/** «i» con la explicación al pasar el mouse o al enfocarla con el teclado (y al tocarla en el celular). */
export function Hint({ text, label = 'Qué significa' }: { text: string; label?: string }) {
  return (
    <span className="hint" tabIndex={0} role="button" aria-label={`${label}: ${text}`}>
      <InfoIcon size={14} weight="bold" aria-hidden="true" />
      <span className="hint-pop" role="tooltip">
        {text}
      </span>
    </span>
  );
}

export interface TileItem {
  label: string;
  value: string;
  hint?: string;
  /** Explicación al pasar el mouse. */
  help?: string;
}

export function Tiles({ items }: { items: TileItem[] }) {
  return (
    <ul className="tile-row" aria-label="Números del modelo">
      {items.map((t) => (
        <li key={t.label} className="tile">
          <span className="tile-label">
            {t.label}
            {t.help ? <Hint text={t.help} label={t.label} /> : null}
          </span>
          <span className="tile-value tabular">{t.value}</span>
          {t.hint ? <span className="tile-hint">{t.hint}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Modelo sin datos suficientes: qué falta y qué va a pasar cuando llegue (nunca se inventa un número). */
export function WaitingData({ title, message, children }: { title: string; message: string; children?: ReactNode }) {
  return (
    <div className="under-construction grid gap-3">
      <p className="flex items-center gap-2 font-bold">
        <HourglassIcon size={20} aria-hidden="true" className="text-link" />
        {title}
      </p>
      <p className="text-muted">{message}</p>
      {children}
    </div>
  );
}

export function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`titulo-${id}`} className="grid gap-4">
      <div>
        <h2 id={`titulo-${id}`} className="text-xl font-bold">
          {title}
        </h2>
        {intro ? <p className="mt-1 max-w-3xl text-sm text-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Etiqueta corta para ejes: la primera palabra, salvo que dos variables la compartan («Pases»). */
export function shortLabels(labels: string[]): (label: string) => string {
  const first = (l: string) => l.split(' ')[0] ?? l;
  const count = new Map<string, number>();
  for (const l of labels) count.set(first(l), (count.get(first(l)) ?? 0) + 1);
  return (l) => ((count.get(first(l)) ?? 0) > 1 ? l : first(l));
}
