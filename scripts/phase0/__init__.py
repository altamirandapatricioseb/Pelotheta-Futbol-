"""Fase 0: sondas que prueban cada fuente con pocas requests reales.

Cada sonda vive en su propio módulo (`probe_<fuente>.py`), usa el cliente compartido
`sources.http_client.PoliteClient` y deja su informe en `data/raw/phase0/<fuente>.json`.
"""
