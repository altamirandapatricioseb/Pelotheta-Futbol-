"""Catálogo de tarjetas de Situaciones (Interfaz 4, sección 9.6).

`data/situational_catalog.csv` tiene una fila por tarjeta: categoría (A a K), título, condición,
parámetros, qué se mide (el resultado del partido o del siguiente), datos que necesita, nivel y si
hay datos. Las consultas de cada tarjeta están en `sql/situational/*.sql`; el pipeline solo envía
el catálogo (`ingest.load_situations`) y la base recalcula las filas al final de cada corrida.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "data" / "situational_catalog.csv"
SQL_DIR = ROOT / "sql" / "situational"


class Card(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str = Field(pattern=r"^s[0-9]{3}$")
    categoria: str = Field(pattern=r"^[A-K]$")
    titulo_es: str = Field(min_length=3, max_length=80)
    condicion: str = Field(min_length=3)
    parametros: str = ""
    resultado_medido: str = Field(min_length=3)
    datos_requeridos: str = Field(min_length=3)
    nivel: str = Field(pattern=r"^[ABC]$")
    available: bool
    estimada: bool = False
    motivo: str = ""
    # Lo que se destaca en la tarjeta: % de victorias, puntos, diferencia de gol, goles o vallas.
    metrica_principal: Literal["win_pct", "ppg", "goal_diff", "gf", "ga", "clean_pct"] = "win_pct"

    @field_validator("available", "estimada", mode="before")
    @classmethod
    def _bool(cls, value: object) -> object:
        return value.strip().lower() == "true" if isinstance(value, str) else value

    @model_validator(mode="after")
    def _reason(self) -> Card:
        # Una tarjeta sin datos dice qué dato falta; una con datos no lleva motivo.
        if not self.available and not self.motivo:
            raise ValueError(f"{self.id}: sin datos y sin motivo")
        if self.available and self.motivo:
            raise ValueError(f"{self.id}: tiene datos y un motivo de «sin datos»")
        return self


def load_cards(path: Path = CATALOG_PATH) -> list[Card]:
    with path.open(encoding="utf-8", newline="") as handle:
        return [Card.model_validate(row) for row in csv.DictReader(handle)]


def to_payload(cards: list[Card]) -> list[dict[str, object]]:
    """Lote de `ingest.load_situations`: el CSV usa nombres en español; la base, en inglés."""
    return [
        {
            "card_id": c.id,
            "category": c.categoria,
            "title_es": c.titulo_es,
            "condition_es": c.condicion,
            "params_es": c.parametros,
            "measured_es": c.resultado_medido,
            "required_data": c.datos_requeridos,
            "level": c.nivel,
            "available": c.available,
            "estimated": c.estimada,
            "reason_es": c.motivo,
            "main_metric": c.metrica_principal,
            "sort_order": order,
        }
        for order, c in enumerate(cards, start=1)
    ]
