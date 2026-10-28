import 'server-only';

import { z } from 'zod';

import type { WorkflowRun } from './state';

// Cliente mínimo de la API de GitHub para el botón «Actualizar» (ADR 0004). El token es
// fine-grained, solo «Actions: read and write» sobre este repositorio, y vive solo en Vercel
// como variable sensible del servidor: nunca llega al navegador.

const WORKFLOW = 'update.yml';
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const configSchema = z.object({
  GITHUB_DISPATCH_TOKEN: z.string().regex(/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/),
  GITHUB_REPOSITORY: z.string().regex(REPO_PATTERN),
});

export class UpdateError extends Error {}

/** Configuración del botón, o null si falta (el botón se muestra deshabilitado). */
export function readConfig(source: Record<string, string | undefined> = process.env) {
  const parsed = configSchema.safeParse({
    GITHUB_DISPATCH_TOKEN: source.GITHUB_DISPATCH_TOKEN,
    GITHUB_REPOSITORY: source.GITHUB_REPOSITORY ?? 'altamirandapatricioseb/Pelotheta-Futbol-',
  });
  return parsed.success ? parsed.data : null;
}

type Config = NonNullable<ReturnType<typeof readConfig>>;

function headers(config: Config): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.GITHUB_DISPATCH_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'pelotheta-futbol',
  };
}

const runsSchema = z.object({
  workflow_runs: z.array(
    z.object({
      id: z.number(),
      status: z.string(),
      conclusion: z.string().nullable(),
      created_at: z.string(),
      updated_at: z.string(),
    }),
  ),
});

/** Última corrida del workflow de actualización (manual o mensual). */
export async function latestRun(config: Config): Promise<WorkflowRun | null> {
  const url = `https://api.github.com/repos/${config.GITHUB_REPOSITORY}/actions/workflows/${WORKFLOW}/runs?per_page=1`;
  const response = await fetch(url, { headers: headers(config), cache: 'no-store' });
  if (!response.ok) throw new UpdateError(`GitHub respondió ${String(response.status)}`);
  const run = runsSchema.parse(await response.json()).workflow_runs[0];
  if (!run) return null;
  return {
    status: run.status as WorkflowRun['status'],
    conclusion: run.conclusion as WorkflowRun['conclusion'],
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    failedStep: run.conclusion === 'failure' ? await failedStep(config, run.id) : null,
  };
}

const jobsSchema = z.object({
  jobs: z.array(
    z.object({
      steps: z.array(z.object({ name: z.string(), conclusion: z.string().nullable() })).optional(),
    }),
  ),
});

/** Nombre del primer paso fallido de la corrida (para mostrar en la página, sin detalles). */
async function failedStep(config: Config, runId: number): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.GITHUB_REPOSITORY}/actions/runs/${String(runId)}/jobs`;
  const response = await fetch(url, { headers: headers(config), cache: 'no-store' });
  if (!response.ok) return null;
  const jobs = jobsSchema.parse(await response.json()).jobs;
  const step = jobs.flatMap((job) => job.steps ?? []).find((s) => s.conclusion === 'failure');
  return step?.name ?? null;
}

/** Dispara el workflow sobre `main`. GitHub responde 204 sin cuerpo. */
export async function dispatch(config: Config): Promise<void> {
  const url = `https://api.github.com/repos/${config.GITHUB_REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headers(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
    cache: 'no-store',
  });
  if (response.status !== 204) throw new UpdateError(`GitHub respondió ${String(response.status)}`);
}
