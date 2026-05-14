"""Worker de procesamiento de jobs.

Corre en un thread separado para no bloquear el event loop de FastAPI.
El flujo es:
  1. job llega con status='queued'
  2. worker lo pone en 'processing', descarga el vídeo de S3 a /tmp
  3. ejecuta los pasos solicitados actualizando progress
  4. guarda results en DB y pone status='done' (o 'error')
  5. borra el fichero temporal
"""

import logging
import os
import threading
import time
import traceback

from src.db import job_get, job_update
from src.storage import download_to_tmp

logger = logging.getLogger(__name__)

# Semáforo global — máx 2 jobs procesando a la vez
# Evita que 30 jobs confirmados simultáneamente saturen RAM y disco
MAX_CONCURRENT_WORKERS = 2
_semaphore = threading.Semaphore(MAX_CONCURRENT_WORKERS)

STEP_WEIGHTS = {
    "quality": 30,
    "denoise": 30,
    "speakers": 40,
}


def process_job(job_id: str) -> None:
    """Punto de entrada del worker. Debe llamarse desde un thread executor.

    Espera a que haya un slot libre (máx MAX_CONCURRENT_WORKERS a la vez).
    El job queda en 'queued' mientras espera — la UI lo ve en cola.
    """
    job = job_get(job_id)
    if not job:
        logger.error("Job %s no encontrado", job_id)
        return

    if job["status"] not in ("queued",):
        logger.warning("Job %s en estado inesperado: %s", job_id, job["status"])
        return

    logger.info("Job %s — esperando slot (semáforo)", job_id)
    _semaphore.acquire()   # bloquea hasta que haya hueco

    job_update(job_id, status="processing", progress=0)
    tmp_path = None
    t_job_start = time.monotonic()

    try:
        # 1. Descargar vídeo de S3
        logger.info("Job %s — descargando %s", job_id, job["s3_key"])
        t0 = time.monotonic()
        tmp_path = download_to_tmp(job["s3_key"])
        logger.info("Job %s — descarga OK (%.1fs)", job_id, time.monotonic() - t0)

        steps = job["steps"]
        results: dict = {"file": job["label"], "steps_run": steps}
        progress = 0

        # 2. Ejecutar pasos
        if "quality" in steps:
            logger.info("Job %s — [quality] inicio", job_id)
            t0 = time.monotonic()
            from src.analysis.quality import analyze as analyze_quality
            from src.analysis.silence import detect_silences
            results["quality"] = analyze_quality(tmp_path, job["label"])
            results["silences"] = detect_silences(tmp_path)
            progress += STEP_WEIGHTS["quality"]
            job_update(job_id, progress=progress, current_step="quality")
            logger.info("Job %s — [quality] OK (%.1fs) → progress=%d", job_id, time.monotonic() - t0, progress)

        if "denoise" in steps:
            logger.info("Job %s — [denoise] inicio", job_id)
            t0 = time.monotonic()
            from src.analysis.denoise import analyze_with_denoise
            results["denoise"] = analyze_with_denoise(tmp_path)
            progress += STEP_WEIGHTS["denoise"]
            job_update(job_id, progress=progress, current_step="denoise")
            logger.info("Job %s — [denoise] OK (%.1fs) → progress=%d", job_id, time.monotonic() - t0, progress)

        if "speakers" in steps:
            logger.info("Job %s — [speakers] inicio", job_id)
            t0 = time.monotonic()
            from src.analysis.speakers import detect_all_turns
            from src.pipeline import get_pipeline, is_pipeline_ready
            if not is_pipeline_ready():
                raise RuntimeError("Pipeline de diarización no está listo")
            results["speakers"] = detect_all_turns(tmp_path, get_pipeline())
            progress += STEP_WEIGHTS["speakers"]
            job_update(job_id, progress=progress, current_step="speakers")
            logger.info("Job %s — [speakers] OK (%.1fs) → progress=%d", job_id, time.monotonic() - t0, progress)

        # 3. Guardar resultados — serializar numpy
        import numpy as np

        def np_clean(obj):
            if isinstance(obj, dict):
                return {k: np_clean(v) for k, v in obj.items()}
            if isinstance(obj, list):
                return [np_clean(v) for v in obj]
            if isinstance(obj, (np.floating, np.float32, np.float64)):
                return float(obj)
            if isinstance(obj, np.integer):
                return int(obj)
            return obj

        total_s = time.monotonic() - t_job_start
        job_update(job_id, status="done", progress=100, results=np_clean(results))
        logger.info("Job %s — done (total %.1fs)", job_id, total_s)

    except Exception as exc:
        total_s = time.monotonic() - t_job_start
        logger.error("Job %s — error tras %.1fs: %s", job_id, total_s, exc)
        job_update(job_id, status="error", error_msg=traceback.format_exc())

    finally:
        _semaphore.release()   # liberar slot para el siguiente job en cola
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
