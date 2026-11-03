"""El PDF de entrega incluye todos los documentos, con índice y diagramas en SVG."""

import pytest

pytest.importorskip("mistune")

from scripts import entrega  # noqa: E402


def test_every_chapter_exists_and_is_indexed():
    page = entrega.build()
    assert page.count('<li><a href="#c') == len(entrega.CHAPTERS)
    assert "```mermaid" not in page
    assert "diagramas/svg/der-1.svg" in page
