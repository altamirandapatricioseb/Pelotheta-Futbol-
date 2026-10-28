"""Catálogo de gráficos de la Interfaz 1 (9.2.1) y mapa de origen de los datos (9.9).

`data/chart_catalog.csv` tiene una fila por gráfico: categoría (letra de la sección de la
landing), título, tipo, datos que necesita, de qué conjunto de estadísticas sale (`origen_ref`,
por ejemplo `equipo:eq_resultados`), si se lleva a Power BI y a Excel y si hay datos para
dibujarlo. Si no hay datos, `motivo` explica por qué y la web muestra la tarjeta «sin datos».

`data/chart_source_map.csv` dice adónde lleva el botón «Ver origen de los datos» de cada
gráfico: `destino_tipo` (tabla, tarjeta, desglosada, partido o comparar), `destino_ref` (la
página) y `parametros` (la consulta de la URL, por ejemplo `conjunto=eq_resultados`).
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ROOT = Path(__file__).resolve().parent.parent
CHARTS_PATH = ROOT / "data" / "chart_catalog.csv"
SOURCES_PATH = ROOT / "data" / "chart_source_map.csv"

Export = Literal["sí", "alternativa", "no"]
TargetType = Literal["tabla", "tarjeta", "desglosada", "partido", "comparar"]
# Página de la web de cada tipo de destino (la tabla puede ser la de equipo o la de jugadores).
TARGET_PAGES: dict[str, tuple[str, ...]] = {
    "tabla": ("equipo", "jugadores"),
    "tarjeta": ("situaciones",),
    "desglosada": ("estadistica",),
    "partido": ("partido",),
    "comparar": ("comparar",),
}


class Chart(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str = Field(pattern=r"^g[0-9]{2,3}$")
    categoria: str = Field(pattern=r"^[A-Q]$")
    titulo_es: str = Field(min_length=3, max_length=90)
    tipo: str = Field(pattern=r"^[a-z_]+$")
    datos_requeridos: str = Field(min_length=3)
    origen_ref: str = Field(pattern=r"^(equipo|jugadores):[a-z_]+$")
    powerbi: Export
    excel: Export
    available: bool
    motivo: str = ""

    @field_validator("available", mode="before")
    @classmethod
    def _bool(cls, value: object) -> object:
        return value.strip().lower() == "true" if isinstance(value, str) else value

    @model_validator(mode="after")
    def _reason(self) -> Chart:
        # Un gráfico sin datos siempre dice por qué; uno con datos no lleva motivo.
        if not self.available and not self.motivo:
            raise ValueError(f"{self.id}: sin datos y sin motivo")
        if self.available and self.motivo:
            raise ValueError(f"{self.id}: tiene datos y un motivo de «sin datos»")
        return self


class ChartSource(BaseModel):
    model_config = ConfigDict(frozen=True)

    chart_id: str = Field(pattern=r"^g[0-9]{2,3}$")
    destino_tipo: TargetType
    destino_ref: str = Field(pattern=r"^[a-z]+$")
    parametros: str = Field(default="", pattern=r"^([a-z]+=[a-z0-9_]+(&[a-z]+=[a-z0-9_]+)*)?$")
    etiqueta_es: str = Field(min_length=3)

    def href(self) -> str:
        return f"/{self.destino_ref}?{self.parametros}" if self.parametros else f"/{self.destino_ref}"


def _rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def load_charts(path: Path = CHARTS_PATH) -> list[Chart]:
    return [Chart.model_validate(row) for row in _rows(path)]


def load_sources(path: Path = SOURCES_PATH) -> list[ChartSource]:
    return [ChartSource.model_validate(row) for row in _rows(path)]


def to_payload(charts: list[Chart], sources: list[ChartSource]) -> dict[str, list[dict[str, object]]]:
    """Lote de `ingest.load_charts`: el CSV usa nombres en español; la base, en inglés."""
    return {
        "charts": [
            {
                "chart_id": c.id,
                "category": c.categoria,
                "title_es": c.titulo_es,
                "chart_type": c.tipo,
                "required_data": c.datos_requeridos,
                "origin_ref": c.origen_ref,
                "powerbi": c.powerbi,
                "excel": c.excel,
                "available": c.available,
                "reason_es": c.motivo,
                "sort_order": order,
            }
            for order, c in enumerate(charts, start=1)
        ],
        "sources": [
            {
                "chart_id": s.chart_id,
                "target_type": s.destino_tipo,
                "target_ref": s.destino_ref,
                "params": s.parametros,
                "label_es": s.etiqueta_es,
            }
            for s in sources
        ],
    }
