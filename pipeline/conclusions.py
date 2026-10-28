"""Reglas de las conclusiones de la Interfaz 4 (`data/conclusion_catalog.csv`).

Cada regla dice qué medir (el promedio de Boca en todas las competiciones contra la liga, copas
contra liga, una proporción, la parte de una posición o el valor de cada jugador frente al plantel),
dónde cortar las bandas (alta, media y baja) y qué decir con qué tono en cada una. La frase final
la arma la base con los números de la temporada en curso (`core.refresh_conclusions`): si los
números cambian, cambia la conclusión. Acá no hay ninguna conclusión escrita a mano.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "data" / "conclusion_catalog.csv"

Tone = Literal["positivo", "negativo", "neutral", ""]
PLACEHOLDERS = frozenset({"valor", "referencia", "percentil", "n", "jugador"})
# «todos»: los jugadores de campo (reglas de tipo jugador).
POSITIONS = frozenset({"equipo", "todos", "Arquero", "Defensor", "Mediocampista", "Delantero"})


class Rule(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    area: str = Field(min_length=3)
    titulo_es: str = Field(min_length=3)
    tipo: Literal["liga", "proporcion", "cuota", "jugador", "competencia"]
    clave_num: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    clave_den: str = ""
    alcance: str
    factor: float = 1
    unidad: Literal["pp", "%", "prop", "pp90", "x"]
    umbral_alto: float
    umbral_bajo: float
    minimo: float = 0
    tono_alto: Tone
    tono_medio: Tone
    tono_bajo: Tone
    texto_alto: str = ""
    texto_medio: str = ""
    texto_bajo: str = ""
    enlace: str = ""

    @model_validator(mode="after")
    def _coherent(self) -> Rule:
        if self.alcance not in POSITIONS:
            raise ValueError(f"{self.id}: alcance desconocido {self.alcance}")
        if self.umbral_bajo >= self.umbral_alto:
            raise ValueError(f"{self.id}: el umbral bajo tiene que ser menor que el alto")
        if self.tipo in ("proporcion", "jugador") and not self.clave_den:
            raise ValueError(f"{self.id}: una proporción necesita denominador")
        if self.tipo == "liga" and not self.clave_den:
            # El valor de Boca sale de sus partidos en todas las competiciones (clave del equipo).
            raise ValueError(f"{self.id}: una regla de liga necesita la clave de Boca en clave_den")
        # Las frases de un jugador lo nombran; las del equipo, no.
        texts = (self.texto_alto, self.texto_medio, self.texto_bajo)
        if self.tipo == "jugador" and not all("{jugador}" in t for t in texts if t):
            raise ValueError(f"{self.id}: una regla de jugador tiene que nombrar al jugador")
        if self.tipo != "jugador" and any("{jugador}" in t for t in texts):
            raise ValueError(f"{self.id}: solo las reglas de jugador usan {{jugador}}")
        # Una banda con tono tiene frase y una banda con frase tiene tono.
        for tone, text, band in (
            (self.tono_alto, self.texto_alto, "alta"),
            (self.tono_medio, self.texto_medio, "media"),
            (self.tono_bajo, self.texto_bajo, "baja"),
        ):
            if bool(tone) != bool(text):
                raise ValueError(f"{self.id}: la banda {band} tiene tono sin frase o frase sin tono")
            unknown = set(re.findall(r"\{(\w+)\}", text)) - PLACEHOLDERS
            if unknown:
                raise ValueError(f"{self.id}: marcadores desconocidos {sorted(unknown)}")
        return self


def load_rules(path: Path = CATALOG_PATH) -> list[Rule]:
    with path.open(encoding="utf-8", newline="") as handle:
        return [Rule.model_validate(row) for row in csv.DictReader(handle)]


def to_payload(rules: list[Rule]) -> list[dict[str, object]]:
    """Lote de `ingest.load_conclusions`."""
    return [
        {
            "rule_id": r.id,
            "area": r.area,
            "title_es": r.titulo_es,
            "kind": r.tipo,
            "num_key": r.clave_num,
            "den_key": r.clave_den,
            "scope": r.alcance,
            "factor": r.factor,
            "unit": r.unidad,
            "high": r.umbral_alto,
            "low": r.umbral_bajo,
            "min_n": r.minimo,
            "tone_high": r.tono_alto,
            "tone_mid": r.tono_medio,
            "tone_low": r.tono_bajo,
            "text_high": r.texto_alto,
            "text_mid": r.texto_medio,
            "text_low": r.texto_bajo,
            "link": r.enlace,
            "sort_order": order,
        }
        for order, r in enumerate(rules, start=1)
    ]
