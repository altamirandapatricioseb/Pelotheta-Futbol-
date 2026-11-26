import 'server-only';

import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { z } from 'zod';

// Capa fría pública (docs/formato-parquet.md). Se lee en el servidor y se cachea una hora: Hugging
// Face recibe un pedido por archivo y hora, no uno por visita (límite anónimo: 3000 cada 5 min por IP).
export const DATASET_URL = 'https://huggingface.co/datasets/pelotheta/pelotheta-futbol';
const BASE = `${DATASET_URL}/resolve/main/`;
const REVALIDATE_S = 3600;

export type ArchiveResult<T> = { ok: true; data: T } | { ok: false; code: 'PEL-ARC-001'; detail: string };

// pyarrow escribe los enteros como INT64 y hyparquet los devuelve como bigint. El faltante sigue null.
const num = z.union([z.number(), z.bigint().transform(Number)]).nullable();
const text = z.string().nullable();

const manifestSchema = z.object({
  archivos: z.array(z.object({ ruta: z.string(), tabla: z.string() })),
});

const identitySchema = z.object({
  uid: z.string(),
  name: z.string(),
  short_name: text,
  country: text,
  country_code: text,
  aliases: text,
});

const matchSchema = z.object({
  match_id: num,
  match_date: z.string(),
  round_label: text,
  competition_name: text,
  boca_home: z.boolean().nullable(),
  opponent: text,
  goals_for: num,
  goals_against: num,
  status: text,
});

const standingSchema = z.object({
  table_name: z.string(),
  rank: num,
  team_name: z.string(),
  played: num,
  won: num,
  drawn: num,
  lost: num,
  goals_for: num,
  goals_against: num,
  points: num,
});

export type ClubMatch = z.infer<typeof matchSchema>;
export type StandingRow = z.infer<typeof standingSchema>;
export interface StandingTable {
  name: string;
  rows: StandingRow[];
}
export interface Club {
  uid: string;
  name: string;
  country: string | null;
  matches: ClubMatch[];
  standings: StandingTable[];
}

async function fetchFile(path: string): Promise<Response> {
  const res = await fetch(BASE + path, { next: { revalidate: REVALIDATE_S } });
  if (!res.ok) throw new Error(`${path}: HTTP ${String(res.status)}`);
  return res;
}

async function readTable<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  const rows = await parquetReadObjects({ file: await (await fetchFile(path)).arrayBuffer(), compressors });
  return rows.map((r) => schema.parse(r));
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Las tablas de posiciones donde aparece el club (por nombre, nombre corto o alias), con su orden. */
export function standingsFor(rows: readonly StandingRow[], names: readonly string[]): StandingTable[] {
  const wanted = new Set(names.map(norm));
  const tables = new Map<string, StandingRow[]>();
  for (const r of rows) tables.set(r.table_name, [...(tables.get(r.table_name) ?? []), r]);
  return [...tables]
    .filter(([, t]) => t.some((r) => wanted.has(norm(r.team_name))))
    .map(([name, t]) => ({ name, rows: t.toSorted((a, b) => (a.rank ?? 99) - (b.rank ?? 99)) }));
}

/** Ficha pública de un club por su id estable (`arg-boca-juniors`); null si no está en el archivo. */
export async function getClub(uid: string): Promise<ArchiveResult<Club | null>> {
  try {
    const [manifest, identities] = await Promise.all([
      fetchFile('manifest.json').then(async (r) => manifestSchema.parse(await r.json())),
      readTable('referencia/team_identity.parquet', identitySchema),
    ]);
    const club = identities.find((t) => t.uid === uid);
    if (!club) return { ok: true, data: null };
    const files = (tabla: string, fragment: string) =>
      manifest.archivos.filter((f) => f.tabla === tabla && f.ruta.includes(fragment)).map((f) => f.ruta);
    // shortcut: las posiciones se buscan en todas las ligas del país; con varias temporadas hay que elegir la última.
    const [matches, standings] = await Promise.all([
      Promise.all(files('boca_match', `/equipo=${uid}/`).map((p) => readTable(p, matchSchema))),
      Promise.all(
        files('league_standing', `pais=${club.country_code ?? ''}/`).map((p) => readTable(p, standingSchema)),
      ),
    ]);
    const names = [club.name, club.short_name ?? '', ...z.array(z.string()).parse(JSON.parse(club.aliases ?? '[]'))];
    return {
      ok: true,
      data: {
        uid,
        name: club.name,
        country: club.country,
        matches: matches.flat().toSorted((a, b) => a.match_date.localeCompare(b.match_date)),
        standings: standingsFor(standings.flat(), names.filter(Boolean)),
      },
    };
  } catch (cause) {
    return { ok: false, code: 'PEL-ARC-001', detail: cause instanceof Error ? cause.message : String(cause) };
  }
}
