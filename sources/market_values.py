"""Valores de mercado cargados a mano desde `data/manual/market_values.csv`.

Por qué a mano y no scrapeado: Transfermarkt prohíbe en sus términos el acceso automatizado y no
tiene API pública (docs/source_audit.md: descartada para scraping). El dueño copia el valor de la
ficha de cada jugador con su fecha y su URL; el pipeline lo valida y lo carga con la fuente.

Formato (UTF-8, coma, con encabezado; fecha ISO AAAA-MM-DD):
    jugador,equipo,fecha,valor_eur,fuente,url
    Jugador Ejemplo,boca-juniors,2026-10-01,1500000,transfermarkt,https://www.transfermarkt.com/...
"""

from __future__ import annotations

import csv
from collections.abc import Callable
from datetime import date
from pathlib import Path

from pydantic import ValidationError

from pipeline.models import MarketValueRecord

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "data" / "manual" / "market_values.csv"
COLUMNS = ("jugador", "equipo", "fecha", "valor_eur", "fuente", "url")


def parse(
    path: Path, match_player: Callable[[str], int | None], warnings: list[str]
) -> list[MarketValueRecord]:
    """Filas válidas del CSV. Una fila con error se avisa y se saltea: no corta la carga."""
    if not path.exists():
        return []
    rows: list[MarketValueRecord] = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = [c for c in COLUMNS[:5] if c not in (reader.fieldnames or [])]
        if missing:
            warnings.append(f"market_values.csv sin columnas: {', '.join(missing)}")
            return []
        for line, raw in enumerate(reader, start=2):
            name = (raw.get("jugador") or "").strip()
            player_id = match_player(name) if name else None
            if player_id is None:
                warnings.append(f"market_values.csv línea {line}: jugador «{name}» no encontrado")
                continue
            try:
                rows.append(
                    MarketValueRecord(
                        player_id=player_id,
                        team_slug=(raw.get("equipo") or "").strip(),
                        as_of=date.fromisoformat((raw.get("fecha") or "").strip()),
                        value_eur=int(float((raw.get("valor_eur") or "").strip())),
                        source=(raw.get("fuente") or "").strip(),
                        source_url=(raw.get("url") or "").strip() or None,
                    )
                )
            except (ValueError, ValidationError) as exc:
                warnings.append(f"market_values.csv línea {line}: {type(exc).__name__}")
    return rows
