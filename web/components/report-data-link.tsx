'use client';

import { usePathname } from 'next/navigation';

import { reportUrl } from '@/lib/errors';

/** Abre un issue de GitHub ya completado con la página actual (16.6): sin formulario propio. */
export function ReportDataLink() {
  const pathname = usePathname();
  // La URL completa (con filtros) solo existe en el navegador: se completa antes de cualquier clic.
  const withFilters = (e: React.SyntheticEvent<HTMLAnchorElement>) => {
    e.currentTarget.href = reportUrl(window.location.href);
  };
  return (
    <a
      href={reportUrl(pathname)}
      onPointerEnter={withFilters}
      onFocus={withFilters}
      className="focus-ring underline"
      target="_blank"
      rel="noreferrer"
    >
      Reportar un dato incorrecto
    </a>
  );
}
