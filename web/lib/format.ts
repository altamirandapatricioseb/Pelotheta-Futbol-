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

const integerFormatter = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Números con separador argentino (1.234) y `n/d` para los ausentes. */
export function formatNumber(value: number | null | undefined, decimals: 0 | 1 = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return NOT_AVAILABLE;
  return (decimals === 0 ? integerFormatter : decimalFormatter).format(value);
}

/** Días enteros desde una fecha (null si la fecha no es válida). */
export function daysSince(iso: string, now: Date = new Date()): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

/** «hoy», «hace 1 día», «hace 12 días»: indicador de frescura de los datos (9.10). */
export function formatRelativeDays(iso: string, now: Date = new Date()): string {
  const days = daysSince(iso, now);
  if (days === null) return NOT_AVAILABLE;
  if (days <= 0) return 'hoy';
  return days === 1 ? 'hace 1 día' : `hace ${String(days)} días`;
}
