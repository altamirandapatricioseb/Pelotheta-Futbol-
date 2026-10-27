// Formato argentino (sección 9.10): fechas dd/mm/aaaa, huso horario de Buenos Aires y
// coma decimal. Se centraliza para que todo el sitio escriba igual.

const TIME_ZONE = 'America/Argentina/Buenos_Aires';

const dateTimeFormatter = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Texto que se usa en todo el sitio cuando un dato no está disponible. */
export const NOT_AVAILABLE = 'n/d';

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return NOT_AVAILABLE;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return NOT_AVAILABLE;
  return dateTimeFormatter.format(date);
}
