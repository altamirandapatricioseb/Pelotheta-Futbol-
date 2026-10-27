import { HammerIcon } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';

interface UnderConstructionProps {
  title: string;
  stage: number;
  description: string;
}

/** Interfaz todavía no publicada: dice qué va a mostrar y en qué etapa llega (3.1). */
export function UnderConstruction({ title, stage, description }: UnderConstructionProps) {
  return (
    <div className="grid gap-6">
      <h1 className="page-title">
        <span className="title-trace">{title}</span>
      </h1>
      <div className="under-construction">
        <p className="flex items-center gap-2 font-bold">
          <HammerIcon size={20} aria-hidden="true" className="text-link" />
          En construcción: llega en la etapa {stage}.
        </p>
        <p className="text-muted">{description}</p>
        <p>
          Mientras tanto, la tabla del plantel ya está en{' '}
          <Link href="/jugadores" className="font-semibold text-link underline underline-offset-4 focus-ring">
            Jugadores
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
