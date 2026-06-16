"""Worker de procesamiento de jobs.

Corre en un thread separado para no bloquear el event loop de FastAPI.

Si USE_MODAL_GPU=true, offloadea TODO el pipeline a Modal (GPU T4).
Si no, corre localmente en CPU (fallback).
"""

import logging
import os
import tempfile
import threading
import time
import traceback
import urllib.request

from src.db import job_get, job_update
from src.storage import download_to_tmp, presigned_download_url

logger = logging.getLogger(__name__)

MAX_CONCURRENT_WORKERS = 100
_semaphore = threading.Semaphore(MAX_CONCURRENT_WORKERS)


def _run_modal_pipeline(job_id: str, s3_key: str, steps: list[str]) -> dict:
    """Generate presigned URL and send to Modal for GPU processing."""
    import modal

    logger.info("Job %s — generating presigned URL for Modal...", job_id)
    video_url = presigned_download_url(s3_key, expires=3600)
    logger.info("Job %s — presigned URL ready", job_id)

    job_update(job_id, progress=10, current_step="modal_sending")

    logger.info("Job %s — calling Modal GPU pipeline (steps=%s)", job_id, steps)
    analyzer = modal.Cls.from_name("analyzer-edustudio", "Analyzer")
    result = analyzer().run_pipeline.remote(video_path=video_url, steps=steps)

    if "error" in result:
        raise RuntimeError(result["error"])

    return result


def _run_modal_pipeline_url(job_id: str, video_url: str, steps: list[str]) -> dict:
    """Send an external video URL directly to Modal for GPU processing."""
    import modal

    logger.info("Job %s — sending external URL to Modal...", job_id)
    job_update(job_id, progress=10, current_step="modal_sending")

    logger.info("Job %s — calling Modal GPU pipeline (steps=%s)", job_id, steps)
    analyzer = modal.Cls.from_name("analyzer-edustudio", "Analyzer")
    result = analyzer().run_pipeline.remote(video_path=video_url, steps=steps)

    if "error" in result:
        raise RuntimeError(result["error"])

    return result


def _run_local_pipeline(job_id: str, tmp_path: str, steps: list[str], label: str) -> dict:
    """Fallback: run pipeline locally on CPU."""
    results: dict = {}
    progress = 0

    if "quality" in steps:
        logger.info("Job %s — [quality] local CPU", job_id)
        t0 = time.monotonic()
        from src.analysis.quality import analyze as analyze_quality
        from src.analysis.silence import detect_silences
        results["quality"] = analyze_quality(tmp_path, label)
        results["silences"] = detect_silences(tmp_path)
        progress += 30
        job_update(job_id, progress=progress, current_step="quality")
        logger.info("Job %s — [quality] OK (%.1fs)", job_id, time.monotonic() - t0)

    if "denoise" in steps:
        logger.info("Job %s — [denoise] local CPU", job_id)
        t0 = time.monotonic()
        from src.analysis.denoise import analyze_with_denoise
        results["denoise"] = analyze_with_denoise(tmp_path)
        progress += 30
        job_update(job_id, progress=progress, current_step="denoise")
        logger.info("Job %s — [denoise] OK (%.1fs)", job_id, time.monotonic() - t0)

    if "speakers" in steps:
        logger.info("Job %s — [speakers] local CPU", job_id)
        t0 = time.monotonic()
        from src.analysis.speakers import detect_all_turns
        from src.pipeline import get_pipeline, initialize_pipeline, is_pipeline_ready
        if not is_pipeline_ready():
            initialize_pipeline()
        results["speakers"] = detect_all_turns(tmp_path, get_pipeline())
        progress += 40
        job_update(job_id, progress=progress, current_step="speakers")
        logger.info("Job %s — [speakers] OK (%.1fs)", job_id, time.monotonic() - t0)

    return results


def _download_url_to_tmp(url: str) -> str:
    """Download a file from an external URL to a temp path."""
    ext = os.path.splitext(url.split("?")[0])[1] or ".mp4"
    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    tmp.close()
    urllib.request.urlretrieve(url, tmp.name)
    return tmp.name


def _resolve_video_source(job: dict) -> tuple[str | None, str | None]:
    """Returns (video_url_for_modal, s3_key_or_none).

    For external URLs: video_url is the URL itself, s3_key is None.
    For MinIO uploads: video_url is a presigned URL, s3_key is the key.
    """
    if job.get("video_url"):
        return job["video_url"], None
    return None, job.get("s3_key")


def process_job(job_id: str) -> None:
    job = job_get(job_id)
    if not job:
        logger.error("Job %s no encontrado", job_id)
        return

    if job["status"] not in ("queued",):
        logger.warning("Job %s en estado inesperado: %s", job_id, job["status"])
        return

    logger.info("Job %s — esperando slot (semáforo)", job_id)
    _semaphore.acquire()

    job_update(job_id, status="processing", progress=0)
    tmp_path = None
    t_job_start = time.monotonic()

    try:
        steps = job["steps"]
        use_modal = os.environ.get("USE_MODAL_GPU", "").lower() == "true"
        video_url, s3_key = _resolve_video_source(job)

        if use_modal:
            logger.info("Job %s — offloading FULL pipeline to Modal GPU (no local download)", job_id)
            try:
                if video_url:
                    results = _run_modal_pipeline_url(job_id, video_url, steps)
                else:
                    results = _run_modal_pipeline(job_id, s3_key, steps)
                results["file"] = job["label"]
                results["execution"] = "modal_gpu"

                if "timings" in results:
                    logger.info("Job %s — Modal timings: %s", job_id, results["timings"])
                if "costs" in results:
                    logger.info("Job %s — Modal costs: %s", job_id, results["costs"])

            except Exception as modal_err:
                logger.warning("Job %s — Modal failed (%s), falling back to local CPU", job_id, modal_err)
                if video_url:
                    logger.info("Job %s — descargando desde URL para fallback local", job_id)
                    tmp_path = _download_url_to_tmp(video_url)
                else:
                    logger.info("Job %s — descargando %s para fallback local", job_id, s3_key)
                    tmp_path = download_to_tmp(s3_key)
                results = _run_local_pipeline(job_id, tmp_path, steps, job["label"])
                results["file"] = job["label"]
                results["execution"] = "local_cpu_fallback"
                results["modal_error"] = str(modal_err)
        else:
            if video_url:
                logger.info("Job %s — descargando desde URL externa", job_id)
                t0 = time.monotonic()
                tmp_path = _download_url_to_tmp(video_url)
            else:
                logger.info("Job %s — descargando %s", job_id, s3_key)
                t0 = time.monotonic()
                tmp_path = download_to_tmp(s3_key)
            logger.info("Job %s — descarga OK (%.1fs)", job_id, time.monotonic() - t0)
            results = _run_local_pipeline(job_id, tmp_path, steps, job["label"])
            results["file"] = job["label"]
            results["execution"] = "local_cpu"

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
        logger.info("Job %s — done (total %.1fs, execution=%s)", job_id, total_s, results.get("execution"))

    except Exception as exc:
        total_s = time.monotonic() - t_job_start
        logger.error("Job %s — error tras %.1fs: %s", job_id, total_s, exc)
        job_update(job_id, status="error", error_msg=traceback.format_exc())

    finally:
        _semaphore.release()
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
