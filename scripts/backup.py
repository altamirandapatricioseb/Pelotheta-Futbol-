"""Backup mensual cifrado (14.2 y 16.5) y su restauración de prueba.

Exporta todas las vistas del esquema `api` (lo que publica el sitio) a JSON, las empaqueta en un
.tar.gz y lo cifra con age para la clave pública de `config/backup_age_recipient.txt`. Solo quien
tiene la clave privada (fuera del repositorio, en la máquina del dueño) puede abrirlo.

Por qué las vistas y no `pg_dump`: `pg_dump` necesita la contraseña de la base, que no está en
GitHub; la clave secreta de la Data API sí. Las vistas contienen todo lo publicado; lo que falta
(tablas crudas) se recalcula con el pipeline desde las fuentes (docs/recuperacion.md).

Uso:
    uv run --with pyrage==1.2.5 python -m scripts.backup --out backups/
    uv run --with pyrage==1.2.5 python -m scripts.backup --verify backups/<archivo>.tar.gz.age \\
        --identity ~/.pelotheta/backup-age.key
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import tarfile
from datetime import UTC, datetime
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
RECIPIENT = ROOT / "config" / "backup_age_recipient.txt"
OPENAPI = ROOT / "web" / "public" / "openapi.json"


def views() -> list[str]:
    """Las vistas que documenta la especificación de la API (una sola lista para todo)."""
    spec = json.loads(OPENAPI.read_text(encoding="utf-8"))
    return sorted(p.strip("/") for p in spec["paths"] if not p.startswith("/rpc/"))


def pack(tables: dict[str, list[dict[str, object]]], created: str) -> bytes:
    """Un .tar.gz con un JSON por vista y un manifiesto con las filas de cada una."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        manifest = {"created": created, "rows": {name: len(rows) for name, rows in tables.items()}}
        for name, content in [("manifest.json", manifest), *[(f"{n}.json", r) for n, r in tables.items()]]:
            data = json.dumps(content, ensure_ascii=False, default=str).encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def unpack(blob: bytes) -> dict[str, object]:
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        out: dict[str, object] = {}
        for member in tar.getmembers():
            handle = tar.extractfile(member)
            if handle is not None:
                out[member.name] = json.loads(handle.read())
        return out


def encrypt(blob: bytes, recipient: str) -> bytes:
    from pyrage import encrypt as age_encrypt
    from pyrage import x25519

    return age_encrypt(blob, [x25519.Recipient.from_str(recipient)])


def decrypt(blob: bytes, identity: str) -> bytes:
    from pyrage import decrypt as age_decrypt
    from pyrage import x25519

    return age_decrypt(blob, [x25519.Identity.from_str(identity)])


def backup(out_dir: Path) -> Path:
    from pipeline.excel import _get
    from pipeline.run import load_dotenv, secret_key

    load_dotenv()
    url, key = os.environ.get("SUPABASE_URL", "").strip(), secret_key()
    if not (url and key):
        raise SystemExit("Faltan SUPABASE_URL o la clave secreta.")
    with httpx.Client(timeout=120) as client:
        tables = {name: _get(client, url, key, name, "*") for name in views()}
    created = datetime.now(UTC).strftime("%Y%m%dT%H%MZ")
    blob = encrypt(pack(tables, created), RECIPIENT.read_text(encoding="utf-8").strip())
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"pelotheta-{created}.tar.gz.age"
    path.write_bytes(blob)
    print(
        f"{path.name}: {len(tables)} vistas, {sum(map(len, tables.values()))} filas, {len(blob) // 1024} KB"
    )
    return path


def verify(path: Path, identity_file: Path) -> None:
    """Restauración de prueba: descifra, abre y compara con el manifiesto."""
    identity = next(
        line.strip() for line in identity_file.read_text().splitlines() if line.startswith("AGE-SECRET-KEY-")
    )
    files = unpack(decrypt(path.read_bytes(), identity))
    manifest = files.pop("manifest.json")
    if not isinstance(manifest, dict):
        raise SystemExit("El backup no tiene manifiesto.")
    for name, count in manifest["rows"].items():
        rows = files.get(f"{name}.json")
        if not isinstance(rows, list) or len(rows) != count:
            raise SystemExit(f"La vista {name} no coincide con el manifiesto.")
    print(f"Restauración verificada: {len(manifest['rows'])} vistas, {sum(manifest['rows'].values())} filas.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backup cifrado de Pelotheta Θ")
    parser.add_argument("--out", type=Path, default=Path("backups"))
    parser.add_argument("--verify", type=Path, help="archivo .age a descifrar y comprobar")
    parser.add_argument("--identity", type=Path, default=Path.home() / ".pelotheta" / "backup-age.key")
    args = parser.parse_args(argv)
    if args.verify:
        verify(args.verify, args.identity.expanduser())
    else:
        backup(args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
