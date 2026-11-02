#!/usr/bin/env bash
# Levanta Pelotheta Θ desde cero en una máquina nueva (16.5) y cronometra cada paso para medir el
# tiempo real de recuperación (RTO). Ver docs/recuperacion.md.
#
#   bash scripts/bootstrap.sh              # dependencias, configuración y pruebas
#   bash scripts/bootstrap.sh --con-datos  # además corre el pipeline completo contra Supabase (~30 min)
#
# No aplica migraciones solo: la base es de producción y eso lo decide una persona
# (`npx supabase db push`, ver docs/recuperacion.md). Nunca imprime claves.
set -euo pipefail

cd "$(dirname "$0")/.."
PNPM="corepack pnpm@10.34.9"
WITH_DATA=0
[ "${1:-}" = "--con-datos" ] && WITH_DATA=1
START=$(date +%s)

step() {
  local name="$1"
  shift
  local t0
  t0=$(date +%s)
  echo "==> $name"
  "$@"
  echo "    listo en $(($(date +%s) - t0)) s"
}

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Falta $1: $2" >&2; exit 1; }
}

check_tools() {
  need git "https://git-scm.com"
  need uv "https://docs.astral.sh/uv/"
  need node "Node 24 (https://nodejs.org)"
  need corepack "viene con Node 24"
  local major
  major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$major" = "24" ] || { echo "Se necesita Node 24 (hay $major)" >&2; exit 1; }
}

check_config() {
  local missing=0
  if [ ! -f .env ]; then
    cp .env.example .env
    echo "    Se creó .env desde .env.example: completá SUPABASE_URL y SUPABASE_SECRET_KEY."
    missing=1
  fi
  if [ ! -f web/.env.local ]; then
    cp web/.env.example web/.env.local
    echo "    Se creó web/.env.local: completá la URL y la clave publicable."
    missing=1
  fi
  # Solo se comprueba que haya valor; el contenido nunca se muestra.
  grep -qE '^SUPABASE_URL=https://[a-z0-9]+\.supabase\.co/?$' .env || { echo "    .env: falta SUPABASE_URL"; missing=1; }
  # El pipeline acepta los dos nombres (pipeline/run.py: secret_key).
  grep -qE '^(API_)?SUPABASE_SECRET_KEY=sb_secret_' .env || { echo "    .env: falta SUPABASE_SECRET_KEY"; missing=1; }
  grep -qE '^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_' web/.env.local ||
    { echo "    web/.env.local: falta la clave publicable"; missing=1; }
  [ "$missing" = 0 ] || { echo "Completá la configuración y volvé a correr el script." >&2; exit 1; }
}

python_deps() { uv sync --locked; }
web_deps() { (cd web && $PNPM install --frozen-lockfile); }
python_tests() { uv run pytest -q; }
web_tests() { (cd web && $PNPM lint && $PNPM typecheck && $PNPM test); }
health() { uv run python -c "
import os, httpx
from pipeline.run import load_dotenv, secret_key
load_dotenv()
url, key = os.environ['SUPABASE_URL'], secret_key()
r = httpx.get(url.rstrip('/') + '/rest/v1/system_status?select=key&limit=1',
              headers={'apikey': key, 'Accept-Profile': 'api'}, timeout=20)
print('    base:', 'responde' if r.status_code == 200 else f'error {r.status_code}')
r.raise_for_status()
"; }
pipeline() { uv run python -m pipeline.run; }
exports() { uv run python -m pipeline.excel && uv run python -m pipeline.powerbi --upload; }
web_build() { (cd web && $PNPM build); }

step "Herramientas" check_tools
step "Configuración" check_config
step "Dependencias de Python" python_deps
step "Dependencias de la web" web_deps
step "Pruebas de Python" python_tests
step "Pruebas de la web" web_tests
step "La base responde" health
if [ "$WITH_DATA" = 1 ]; then
  step "Pipeline completo" pipeline
  step "Excel y Power BI" exports
fi
step "Build de la web" web_build

echo "Todo listo en $(($(date +%s) - START)) s. Para verla: just dev (http://localhost:3000)."
