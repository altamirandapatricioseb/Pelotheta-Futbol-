"""Cliente HTTP respetuoso y auditable, compartido por todas las fuentes.

Por qué existe: las fuentes gratuitas son de terceros y tenemos reglas claras con ellas
(sección 2, regla 4 del proyecto):

- User-Agent identificable, para que el sitio sepa quién pide y cómo contactarnos.
- Pausa mínima de 3 segundos entre requests al mismo host.
- Caché local: una URL ya descargada no se vuelve a pedir.
- Respeto de robots.txt antes de pedir cualquier página.

Y reglas de seguridad (sección 14.4):

- TLS verificado, timeouts y tamaño máximo de respuesta.
- Nunca seguir una redirección hacia otro dominio.
- Cadena de custodia: cada descarga queda en `data/raw/manifest.jsonl` con su SHA-256,
  la URL (sin claves), la fecha y el código HTTP, para poder auditar cualquier número.
- Las claves de API nunca se guardan en la caché, en el manifiesto ni en los logs.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.robotparser
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

REPO_URL = "https://github.com/altamirandapatricioseb/Pelotheta-Futbol-"
USER_AGENT = f"PelothetaBot/0.1 (+{REPO_URL}; proyecto de portfolio sin fines comerciales)"

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
CACHE_DIR = RAW_DIR / "cache"
MANIFEST_PATH = RAW_DIR / "manifest.jsonl"

MIN_DELAY_SECONDS = 3.0
MAX_RESPONSE_BYTES = 15 * 1024 * 1024  # 15 MB: ninguna respuesta legítima de estas fuentes pesa más
DEFAULT_TIMEOUT = httpx.Timeout(20.0, connect=10.0)

# Nombres de parámetros de query que suelen llevar claves. Se reemplazan por "***" antes de
# escribir la URL en el manifiesto o de usarla como clave de caché.
SECRET_PARAM_NAMES = frozenset({"key", "apikey", "api_key", "token", "access_token", "x-apisports-key"})


class FetchError(Exception):
    """Error al pedir una URL que no conviene reintentar (4xx, robots.txt, tamaño, dominio)."""


class RetryableFetchError(Exception):
    """Error transitorio (timeout, 5xx o 429): se reintenta con espera exponencial."""


@dataclass(frozen=True)
class FetchResult:
    url: str  # URL ya enmascarada (sin claves)
    status: int
    content_type: str
    body: bytes
    sha256: str
    from_cache: bool
    fetched_at: str

    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json.loads(self.body)


def mask_url(url: str) -> str:
    """Devuelve la URL con los parámetros que parecen claves reemplazados por '***'."""
    parts = urlsplit(url)
    query = [
        (k, "***" if k.lower() in SECRET_PARAM_NAMES else v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
    ]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query, safe="*"), parts.fragment))


def _same_site(host_a: str, host_b: str) -> bool:
    """Mismo host, salvo el prefijo `www.` (www.fbref.com y fbref.com son el mismo sitio).

    No se comparan solo los dos últimos niveles: en dominios como `football-data.co.uk` eso
    aceptaría cualquier `*.co.uk` como el mismo sitio.
    """
    return host_a.lower().removeprefix("www.") == host_b.lower().removeprefix("www.")


@dataclass
class PoliteClient:
    """Cliente HTTP con pausa por host, caché, robots.txt y manifiesto.

    `source` es el nombre corto de la fuente (por ejemplo "fbref"); separa la caché por fuente.
    `min_delay` se puede subir para sitios que piden más espacio (FBref pide ≤ 10 por minuto).
    """

    source: str
    min_delay: float = MIN_DELAY_SECONDS
    respect_robots: bool = True
    cache_dir: Path = CACHE_DIR
    manifest_path: Path = MANIFEST_PATH
    _last_request_at: dict[str, float] = field(default_factory=dict)
    _robots: dict[str, urllib.robotparser.RobotFileParser | None] = field(default_factory=dict)
    _client: httpx.Client | None = None

    def __post_init__(self) -> None:
        if self.min_delay < MIN_DELAY_SECONDS:
            # La regla del proyecto es un piso: nadie puede bajar la pausa por debajo de 3 s.
            raise ValueError(f"min_delay no puede ser menor a {MIN_DELAY_SECONDS} s")

    # --- ciclo de vida -------------------------------------------------------------------
    def __enter__(self) -> PoliteClient:
        self._client = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept-Language": "es-AR,es;q=0.9,en;q=0.8"},
            timeout=DEFAULT_TIMEOUT,
            follow_redirects=False,  # las redirecciones se siguen a mano para validar el dominio
            verify=True,
        )
        return self

    def __exit__(self, *exc: object) -> None:
        if self._client is not None:
            self._client.close()

    # --- API pública ---------------------------------------------------------------------
    def get(
        self,
        url: str,
        *,
        params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        use_cache: bool = True,
        check_robots: bool | None = None,
    ) -> FetchResult:
        """Pide una URL con GET respetando caché, robots.txt y la pausa mínima.

        `headers` sirve para claves de API: nunca se guardan ni forman parte de la clave de caché.
        """
        full_url = str(httpx.URL(url, params=params)) if params else url
        masked = mask_url(full_url)
        cache_key = hashlib.sha256(masked.encode()).hexdigest()

        if use_cache:
            cached = self._read_cache(cache_key)
            if cached is not None:
                return cached

        should_check = self.respect_robots if check_robots is None else check_robots
        if should_check and not self.robots_allows(full_url):
            raise FetchError(f"robots.txt no permite {masked} para nuestro User-Agent")

        status, content_type, body, final_url = self._fetch_with_retries(full_url, headers or {})
        result = FetchResult(
            url=mask_url(final_url),
            status=status,
            content_type=content_type,
            body=body,
            sha256=hashlib.sha256(body).hexdigest(),
            from_cache=False,
            fetched_at=datetime.now(UTC).isoformat(timespec="seconds"),
        )
        self._write_cache(cache_key, result)
        self._append_manifest(result)
        return result

    def robots_allows(self, url: str) -> bool:
        """Lee (una sola vez por host) el robots.txt del sitio y pregunta si la URL está permitida.

        Si el sitio no tiene robots.txt (404) se asume permitido, que es la convención del estándar
        (RFC 9309). Si robots.txt no se puede leer por otro motivo, se asume NO permitido: ante la
        duda, no scrapeamos.
        """
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._robots:
            self._robots[origin] = self._load_robots(origin)
        parser = self._robots[origin]
        if parser is None:
            return False
        return parser.can_fetch(USER_AGENT, url)

    # --- internos ------------------------------------------------------------------------
    def _load_robots(self, origin: str) -> urllib.robotparser.RobotFileParser | None:
        robots_url = f"{origin}/robots.txt"
        try:
            result = self.get(robots_url, check_robots=False)
        except (FetchError, RetryableFetchError):
            return None
        parser = urllib.robotparser.RobotFileParser(robots_url)
        if result.status == 404:
            parser.parse([])  # sin robots.txt: todo permitido
        elif 200 <= result.status < 300:
            parser.parse(result.text().splitlines())
        else:
            return None
        return parser

    def _wait_turn(self, host: str) -> None:
        last = self._last_request_at.get(host)
        if last is not None:
            elapsed = time.monotonic() - last
            if elapsed < self.min_delay:
                time.sleep(self.min_delay - elapsed)
        self._last_request_at[host] = time.monotonic()

    def _fetch_with_retries(self, url: str, headers: dict[str, str]) -> tuple[int, str, bytes, str]:
        @retry(
            retry=retry_if_exception_type(RetryableFetchError),
            wait=wait_exponential(multiplier=self.min_delay, max=60),
            stop=stop_after_attempt(3),
            reraise=True,
        )
        def attempt() -> tuple[int, str, bytes, str]:
            return self._fetch_once(url, headers)

        return attempt()

    def _fetch_once(self, url: str, headers: dict[str, str]) -> tuple[int, str, bytes, str]:
        if self._client is None:
            raise RuntimeError("Usá PoliteClient dentro de un bloque 'with'")
        current = url
        start_host = urlsplit(url).hostname or ""
        for _ in range(5):  # como máximo 5 redirecciones
            host = urlsplit(current).hostname or ""
            if not _same_site(start_host, host):
                raise FetchError(f"Redirección a otro dominio bloqueada: {mask_url(current)}")
            self._wait_turn(host)
            try:
                with self._client.stream("GET", current, headers=headers) as response:
                    if response.is_redirect:
                        location = response.headers.get("location", "")
                        current = urljoin(current, location)
                        continue
                    if response.status_code == 429 or response.status_code >= 500:
                        raise RetryableFetchError(f"HTTP {response.status_code} en {mask_url(current)}")
                    body = self._read_limited(response)
                    content_type = response.headers.get("content-type", "")
                    return response.status_code, content_type, body, current
            except httpx.TimeoutException as exc:
                raise RetryableFetchError(f"Timeout en {mask_url(current)}") from exc
            except httpx.TransportError as exc:
                raise RetryableFetchError(f"Error de red en {mask_url(current)}: {exc}") from exc
        raise FetchError(f"Demasiadas redirecciones: {mask_url(url)}")

    @staticmethod
    def _read_limited(response: httpx.Response) -> bytes:
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_bytes():
            total += len(chunk)
            if total > MAX_RESPONSE_BYTES:
                raise FetchError(f"Respuesta mayor a {MAX_RESPONSE_BYTES} bytes, se descarta")
            chunks.append(chunk)
        return b"".join(chunks)

    def _cache_paths(self, cache_key: str) -> tuple[Path, Path]:
        base = self.cache_dir / self.source
        return base / f"{cache_key}.body", base / f"{cache_key}.meta.json"

    def _read_cache(self, cache_key: str) -> FetchResult | None:
        body_path, meta_path = self._cache_paths(cache_key)
        if not (body_path.exists() and meta_path.exists()):
            return None
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        body = body_path.read_bytes()
        return FetchResult(
            url=meta["url"],
            status=meta["status"],
            content_type=meta["content_type"],
            body=body,
            sha256=hashlib.sha256(body).hexdigest(),
            from_cache=True,
            fetched_at=meta["fetched_at"],
        )

    def _write_cache(self, cache_key: str, result: FetchResult) -> None:
        body_path, meta_path = self._cache_paths(cache_key)
        body_path.parent.mkdir(parents=True, exist_ok=True)
        body_path.write_bytes(result.body)
        meta = {
            "url": result.url,
            "status": result.status,
            "content_type": result.content_type,
            "fetched_at": result.fetched_at,
            "sha256": result.sha256,
        }
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    def _append_manifest(self, result: FetchResult) -> None:
        self.manifest_path.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "source": self.source,
            "url": result.url,
            "status": result.status,
            "content_type": result.content_type,
            "bytes": len(result.body),
            "sha256": result.sha256,
            "fetched_at": result.fetched_at,
        }
        with self.manifest_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
