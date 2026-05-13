"""Router principal.

Endpoints:
  POST   /jobs                    Crea un job y devuelve presigned upload URL
  POST   /jobs/{id}/confirm       Confirma que el upload terminó → encola procesamiento
  GET    /jobs                    Lista todos los jobs (historial)
  GET    /jobs/{id}               Estado y resultados de un job
  DELETE /jobs/{id}               Borra job y su vídeo en S3
  GET    /jobs/{id}/download      Presigned download URL del vídeo
  POST   /jobs/{id}/denoise-preview  Preview denoise de un fragmento
  GET    /health
  GET    /ready
"""

import asyncio
import hmac
import os
from typing import Annotated

import psycopg2
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from src.config import settings
from src.db import job_create, job_delete, job_get, job_list, job_update
from src.storage import delete_object, presigned_download_url, presigned_upload_url

router = APIRouter()
security = HTTPBearer()

VALID_STEPS = {"quality", "speakers", "denoise"}

ALLOWED_EXTENSIONS = {
    ".mp4", ".mov", ".avi", ".webm", ".mkv",
    ".mp3", ".wav", ".ogg", ".m4a",
}


# --------------------------------------------------------------------------- #
# Auth                                                                         #
# --------------------------------------------------------------------------- #

def verify_api_key(credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)]):
    if not hmac.compare_digest(credentials.credentials, settings.api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
    return credentials.credentials


# --------------------------------------------------------------------------- #
# Schemas                                                                      #
# --------------------------------------------------------------------------- #

class CreateJobRequest(BaseModel):
    filename: str
    file_size: int | None = None
    label: str | None = None
    steps: list[str] = ["quality", "speakers", "denoise"]
    content_type: str = "application/octet-stream"


class ConfirmUploadRequest(BaseModel):
    file_size: int | None = None   # puede venir aquí si no se sabía antes


class DenoisePreviewRequest(BaseModel):
    offset_s: float | None = None
    duration_s: float = 30.0


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #

def _parse_steps(steps: list[str]) -> list[str]:
    invalid = set(steps) - VALID_STEPS
    if invalid:
        raise HTTPException(
            status_code=422,
            detail=f"Pasos no válidos: {invalid}. Válidos: {VALID_STEPS}",
        )
    return steps


def _s3_key(job_id: str, filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower() or ".mp4"
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"Extensión no soportada: {ext}")
    return f"videos/{job_id}{ext}"


# --------------------------------------------------------------------------- #
# Jobs                                                                         #
# --------------------------------------------------------------------------- #

@router.post("/jobs", status_code=201)
async def create_job(
    body: CreateJobRequest,
    _: Annotated[str, Depends(verify_api_key)],
):
    """Crea un job y devuelve una presigned URL para que el browser suba el vídeo.

    Flujo:
    1. Cliente llama a POST /jobs con filename, file_size, steps
    2. API crea el job (status=pending) y devuelve upload_url
    3. Cliente hace PUT upload_url con el fichero (directo al bucket, sin pasar por la API)
    4. Cliente llama a POST /jobs/{id}/confirm para arrancar el análisis
    """
    steps = _parse_steps(body.steps)
    label = body.label or body.filename

    try:
        job = job_create(
            label=label,
            filename=body.filename,
            file_size=body.file_size,
            steps=steps,
        )
    except psycopg2.Error as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")

    key = _s3_key(job["id"], body.filename)
    job_update(job["id"], s3_key=key)

    upload_url = presigned_upload_url(key, content_type=body.content_type, expires=7200)

    return {
        "job": {**job, "s3_key": key},
        "upload_url": upload_url,
    }


@router.post("/jobs/{job_id}/confirm")
async def confirm_upload(
    job_id: str,
    body: ConfirmUploadRequest,
    _: Annotated[str, Depends(verify_api_key)],
):
    """Confirma que el upload terminó y encola el procesamiento."""
    job = job_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    if job["status"] not in ("pending", "uploading"):
        raise HTTPException(
            status_code=409,
            detail=f"El job ya está en estado '{job['status']}'",
        )

    updates: dict = {"status": "queued"}
    if body.file_size:
        updates["file_size"] = body.file_size
    job_update(job_id, **updates)

    # Lanzar worker en background (thread executor para no bloquear el event loop)
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _run_worker, job_id)

    return {"job_id": job_id, "status": "queued"}


def _run_worker(job_id: str) -> None:
    from src.worker import process_job
    process_job(job_id)


@router.get("/jobs")
async def list_jobs(
    _: Annotated[str, Depends(verify_api_key)],
    limit: int = 50,
    offset: int = 0,
):
    """Lista todos los jobs ordenados por fecha de creación descendente."""
    jobs = job_list(limit=min(limit, 200), offset=offset)
    return {"jobs": jobs, "count": len(jobs)}


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: str,
    _: Annotated[str, Depends(verify_api_key)],
):
    """Devuelve el estado y resultados de un job."""
    job = job_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    return job


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(
    job_id: str,
    _: Annotated[str, Depends(verify_api_key)],
):
    """Borra el job de la DB y su vídeo del bucket."""
    job = job_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job no encontrado")

    if job.get("s3_key"):
        try:
            delete_object(job["s3_key"])
        except Exception:
            pass  # si no existe en S3 no es error

    if not job_delete(job_id):
        raise HTTPException(status_code=404, detail="Job no encontrado")


@router.get("/jobs/{job_id}/download")
async def download_url(
    job_id: str,
    _: Annotated[str, Depends(verify_api_key)],
):
    """Devuelve una presigned URL temporal para descargar/reproducir el vídeo."""
    job = job_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    if not job.get("s3_key"):
        raise HTTPException(status_code=404, detail="Vídeo no disponible todavía")

    url = presigned_download_url(job["s3_key"], expires=3600)
    return {"url": url, "expires_in": 3600}


# --------------------------------------------------------------------------- #
# Denoise preview (fragmento de un vídeo ya en S3)                            #
# --------------------------------------------------------------------------- #

@router.post("/jobs/{job_id}/denoise-preview")
async def denoise_preview(
    job_id: str,
    body: DenoisePreviewRequest,
    _: Annotated[str, Depends(verify_api_key)],
):
    """Devuelve el audio original y denoised de un fragmento como base64 WAV."""
    job = job_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    if not job.get("s3_key"):
        raise HTTPException(status_code=404, detail="Vídeo no disponible")

    import base64
    import subprocess
    import tempfile

    import librosa
    import noisereduce as nr
    import soundfile as sf

    from src.storage import download_to_tmp

    SR = 16_000
    tmp_orig = None
    tmp_den = None
    source_path = None

    try:
        source_path = download_to_tmp(job["s3_key"])

        offset_s = body.offset_s
        if offset_s is None:
            result = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", source_path],
                capture_output=True, text=True, check=True,
            )
            total = float(result.stdout.strip())
            offset_s = total * 0.25

        tmp_orig = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp_orig.close()
        subprocess.run(
            ["ffmpeg", "-y", "-ss", str(offset_s), "-t", str(body.duration_s),
             "-i", source_path, "-ac", "1", "-ar", str(SR), tmp_orig.name],
            check=True, capture_output=True,
        )

        audio, _ = librosa.load(tmp_orig.name, sr=SR, mono=True)
        reduced = nr.reduce_noise(y=audio, sr=SR, stationary=False, prop_decrease=0.8)
        tmp_den = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp_den.close()
        sf.write(tmp_den.name, reduced, SR)

        with open(tmp_orig.name, "rb") as f:
            orig_b64 = base64.b64encode(f.read()).decode()
        with open(tmp_den.name, "rb") as f:
            den_b64 = base64.b64encode(f.read()).decode()

    finally:
        for p in [source_path, tmp_orig.name if tmp_orig else None, tmp_den.name if tmp_den else None]:
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass

    return JSONResponse(content={
        "offset_s": offset_s,
        "duration_s": body.duration_s,
        "original_wav_b64": orig_b64,
        "denoised_wav_b64": den_b64,
    })


# --------------------------------------------------------------------------- #
# Health                                                                       #
# --------------------------------------------------------------------------- #

@router.get("/health")
async def health():
    from src.pipeline import is_pipeline_ready
    return {
        "status": "ok",
        "service": "analyzer-lab-edustudio",
        "pipeline_ready": is_pipeline_ready(),
    }


@router.get("/ready")
async def ready():
    from src.pipeline import is_pipeline_ready
    if not is_pipeline_ready():
        raise HTTPException(status_code=503, detail="Pipeline cargando...")
    return {"ready": True}
