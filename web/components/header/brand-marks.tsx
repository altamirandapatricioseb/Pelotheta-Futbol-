import { SYSTEM_LOGO_SRC, SYSTEM_NAME, TEAM_NAME, TEAM_PHOTO_SRC } from '@/config/brand';

/** Izquierda del header: foto del equipo (si el dueño la cargó) o monograma, y el nombre. */
export function TeamMark() {
  return (
    <span className="flex items-center gap-3">
      {TEAM_PHOTO_SRC ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagen local chica, sin optimizador
        <img src={TEAM_PHOTO_SRC} alt="" width={36} height={36} className="size-9 rounded-md object-cover" />
      ) : (
        <span aria-hidden="true" className="team-monogram">
          BJ
        </span>
      )}
      <span className="text-base font-bold whitespace-nowrap">{TEAM_NAME}</span>
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
