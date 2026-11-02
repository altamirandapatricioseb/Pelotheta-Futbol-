"""Backup cifrado (14.2): empaquetado, cifrado y verificación de ida y vuelta."""

from __future__ import annotations

import pytest

from scripts import backup


def test_pack_and_unpack_keep_every_row() -> None:
    tables = {"boca_match": [{"match_id": 1}, {"match_id": 2}], "stat_set": []}
    files = backup.unpack(backup.pack(tables, "20261102T0000Z"))
    assert files["manifest.json"] == {"created": "20261102T0000Z", "rows": {"boca_match": 2, "stat_set": 0}}
    assert files["boca_match.json"] == tables["boca_match"]


def test_only_the_private_key_opens_the_backup() -> None:
    x25519 = pytest.importorskip("pyrage").x25519
    mine, other = x25519.Identity.generate(), x25519.Identity.generate()
    blob = backup.encrypt(b"datos", str(mine.to_public()))
    assert backup.decrypt(blob, str(mine)) == b"datos"
    with pytest.raises(Exception):  # noqa: B017 - pyrage lanza su propio tipo de error
        backup.decrypt(blob, str(other))


def test_views_come_from_the_api_specification() -> None:
    names = backup.views()
    assert "boca_match" in names and "pipeline_run_metrics" not in [n for n in names if n.startswith("rpc")]
    assert all(not n.startswith("rpc/") for n in names)
