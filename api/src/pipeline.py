"""Singleton para el pipeline de pyannote.

Se inicializa una sola vez al arrancar la app (lifespan).
Usar get_pipeline() desde cualquier módulo de análisis.
"""

import os
import torch
from pyannote.audio import Pipeline as PyannotePipeline

_pipeline: PyannotePipeline | None = None


def initialize_pipeline() -> None:
    """Descarga (si hace falta) y carga el modelo pyannote en memoria."""
    global _pipeline
    if _pipeline is not None:
        return

    hf_token = os.environ.get("HF_TOKEN")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    print(f"[pipeline] Cargando pyannote/speaker-diarization-3.1 (device={device}) ...", flush=True)
    _pipeline = PyannotePipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        use_auth_token=hf_token,
    ).to(device)
    print("[pipeline] Modelo listo.", flush=True)


def get_pipeline() -> PyannotePipeline:
    if _pipeline is None:
        raise RuntimeError("Pipeline no inicializado. Llama a initialize_pipeline() en el lifespan.")
    return _pipeline
