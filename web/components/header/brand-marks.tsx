import { SYSTEM_LOGO_SRC, SYSTEM_NAME, TEAM_NAME, TEAM_PHOTO_SRC } from '@/config/brand';

/** Izquierda del header: el equipo elegido en el selector, con la foto de Boca si el dueño la cargó
 * o un monograma con sus iniciales. */
export function TeamMark({ name = TEAM_NAME }: { name?: string }) {
  const initials = name
    .split(/\s+/)
    .filter((w) => /^[A-ZÁÉÍÓÚÑ0-9]/.test(w))
    .map((w) => w[0])
    .join('')
    .slice(0, 3);
  return (
    <span className="flex items-center gap-3">
      {TEAM_PHOTO_SRC && name === TEAM_NAME ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagen local chica, sin optimizador
        <img src={TEAM_PHOTO_SRC} alt="" width={36} height={36} className="size-9 object-contain" />
      ) : (
        <span aria-hidden="true" className="team-monogram">
          {initials || name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className="text-base font-bold whitespace-nowrap">{name}</span>
    </span>
  );
}

/** Derecha del header: logo del sistema (opcional) y el nombre del sistema. */
export function SystemMark() {
  return (
    <span className="flex items-center gap-2">
      {SYSTEM_LOGO_SRC ? (
        // eslint-disable-next-line @next/next/no-img-element -- logo local en SVG o PNG
        <img src={SYSTEM_LOGO_SRC} alt="" width={28} height={28} className="size-7" />
      ) : null}
      <span className="system-name">{SYSTEM_NAME}</span>
    </span>
  );
}
