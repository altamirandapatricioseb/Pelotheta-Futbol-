import { CompassIcon } from '@phosphor-icons/react';

/** «Cómo leerla»: qué significa un valor alto, bajo, negativo o cerca de 0 (catálogo, lectura_es). */
export function StatReading({ text, compact = false }: { text: string; compact?: boolean }) {
  if (!text) return null;
  return (
    <p className={`stat-reading${compact ? ' stat-reading--compact' : ''}`}>
      <CompassIcon size={compact ? 14 : 16} weight="bold" aria-hidden="true" />
      <span>
        <span className="sr-only">Cómo leerla: </span>
        {text}
      </span>
    </p>
  );
}
