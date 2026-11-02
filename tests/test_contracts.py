"""Contratos de datos (16.1): cada regla nombra un chequeo que existe y ningún chequeo queda huérfano."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _contract_checks() -> set[str]:
    text = (ROOT / "data" / "contracts.yml").read_text(encoding="utf-8")
    return {c.strip() for line in re.findall(r"^\s+checks: \[(.*)\]$", text, re.M) for c in line.split(",")}


def _sql_checks(path: Path) -> set[str]:
    return set(
        re.findall(r"^\s+\('([a-z_]+)', '[a-z_]+', '[a-z_]+',", path.read_text(encoding="utf-8"), re.M)
    )


def test_contracts_and_checks_match() -> None:
    checks = _sql_checks(ROOT / "sql" / "quality" / "checks.sql")
    assert len(checks) == 16
    assert _contract_checks() == checks


def test_migration_carries_the_same_checks() -> None:
    migration = ROOT / "supabase" / "migrations" / "20261102180000_data_quality.sql"
    assert _sql_checks(migration) == _sql_checks(ROOT / "sql" / "quality" / "checks.sql")
