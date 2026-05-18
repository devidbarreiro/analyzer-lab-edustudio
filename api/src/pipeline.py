"""Singleton para el pipeline de pyannote.

Se inicializa una sola vez al arrancar la app (lifespan).
Usar get_pipeline() desde cualquier módulo de análisis.
"""

import os

# NOTE: torch y pyannote se importan de forma diferida dentro de
# initialize_pipeline() para que el import de este módulo en main.py
# no bloquee el proceso principal antes de que uvicorn pueda abrir el puerto.
_pipeline = None


def initialize_pipeline() -> None:
    """Descarga (si hace falta) y carga el modelo pyannote en memoria."""
    global _pipeline
    if _pipeline is not None:
        return

    # Imports diferidos — pesados, bloquean segundos/minutos
    import torch
    from pyannote.audio import Pipeline as PyannotePipeline

    hf_token = os.environ.get("HF_TOKEN")
    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")

    print(f"[pipeline] Cargando pyannote/speaker-diarization-3.1 (device={device}) ...", flush=True)
    _pipeline = PyannotePipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=hf_token,
    ).to(device)
    print("[pipeline] Modelo listo.", flush=True)


def is_pipeline_ready() -> bool:
    return _pipeline is not None


def get_pipeline():
    if _pipeline is None:
        raise RuntimeError("Pipeline no inicializado. Llama a initialize_pipeline() en el lifespan.")
    return _pipeline
