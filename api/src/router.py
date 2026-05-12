"""Router principal: POST /analyze

Recibe un vídeo (por URL o upload multipart) y ejecuta los pasos de análisis
seleccionados por el cliente: quality, speakers, denoise.

El procesamiento es síncrono — el cliente espera hasta que termina.
Render Free tiene un timeout HTTP de 60s; para vídeos largos usa Render Starter
o configura un timeout mayor en render.yaml.
"""

import hmac
import os
import tempfile
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.config import settings

router = APIRouter()
security = HTTPBearer()


# --------------------------------------------------------------------------- #
# Auth                                                                         #
# --------------------------------------------------------------------------- #

def verify_api_key(credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)]):
    """Compara el token con constant-time comparison para evitar timing attacks."""
    if not hmac.compare_digest(credentials.credentials, settings.api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
    return credentials.credentials


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #

ALLOWED_CONTENT_TYPES = {
    "video/mp4", "video/quicktime", "video/x-msvideo",
    "video/webm", "video/mkv", "audio/mpeg", "audio/wav",
    "audio/x-wav", "audio/ogg", "audio/mp4",
}

MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB


async def _source_from_upload(file: UploadFile) -> tuple[str, bool]:
    """Guarda el upload en un fichero temporal. Devuelve (path, True)."""
    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Tipo de fichero no soportado: {file.content_type}",
        )

    suffix = os.path.splitext(file.filename or "upload")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        tmp_path = f.name
        total = 0
        while chunk := await file.read(1024 * 1024):  # 1 MB chunks
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                os.unlink(tmp_path)
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Fichero demasiado grande (máx 500 MB)",
                )
            f.write(chunk)

    return tmp_path, True


async def _source_from_url(url: str) -> tuple[str, bool]:
    """Descarga una URL a un fichero temporal. Devuelve (path, True)."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=120) as client:
        async with client.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"No se pudo descargar la URL (status {resp.status_code})",
                )
            suffix = ".mp4"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                tmp_path = f.name
                total = 0
                async for chunk in resp.aiter_bytes(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_UPLOAD_BYTES:
                        os.unlink(tmp_path)
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail="Fichero demasiado grande (máx 500 MB)",
                        )
                    f.write(chunk)

    return tmp_path, True


VALID_STEPS = {"quality", "speakers", "denoise"}


def _parse_steps(steps_raw: str | None) -> list[str]:
    if not steps_raw:
        return ["quality", "speakers", "denoise"]
    parsed = [s.strip() for s in steps_raw.split(",") if s.strip()]
    invalid = set(parsed) - VALID_STEPS
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Pasos no válidos: {invalid}. Válidos: {VALID_STEPS}",
        )
    return parsed


# --------------------------------------------------------------------------- #
# Endpoint                                                                     #
# --------------------------------------------------------------------------- #

@router.post("/analyze")
async def analyze(
    _: Annotated[str, Depends(verify_api_key)],
    # Multipart fields
    file: Annotated[UploadFile | None, File()] = None,
    url: Annotated[str | None, Form()] = None,
    steps: Annotated[str | None, Form()] = None,
    label: Annotated[str | None, Form()] = None,
):
    """Analiza un vídeo y devuelve las métricas seleccionadas.

    Acepta:
    - Multipart upload (campo `file`) — el cliente sube el fichero directamente
    - URL (campo `url`)               — la API descarga el vídeo

    Pasos disponibles (campo `steps`, coma-separados, default: todos):
    - quality   → calidad de audio DNSMOS (SIG/BAK/OVRL MOS, SNR, peak, grade)
    - speakers  → diarización pyannote (hablantes, turnos, % tiempo)
    - denoise   → reducción de ruido y comparativa antes/después

    Returns 200 con JSON de resultados. Los pasos no solicitados se omiten.
    """
    if file is None and not url:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Debes proporcionar `file` (multipart) o `url`",
        )
    if file is not None and url:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Proporciona solo `file` o `url`, no ambos",
        )

    selected_steps = _parse_steps(steps)

    # Obtener path del fichero temporal
    if file is not None:
        source_path, is_temp = await _source_from_upload(file)
        source_label = label or file.filename or "upload"
    else:
        source_path, is_temp = await _source_from_url(url)
        source_label = label or url.split("/")[-1].split("?")[0] or "video"

    results: dict = {"file": source_label, "steps_run": selected_steps}

    try:
        if "quality" in selected_steps:
            from src.analysis.quality import analyze as analyze_quality
            results["quality"] = analyze_quality(source_path, source_label)

        if "denoise" in selected_steps:
            from src.analysis.denoise import analyze_with_denoise
            results["denoise"] = analyze_with_denoise(source_path)

        if "speakers" in selected_steps:
            from src.analysis.speakers import detect_all_turns
            from src.pipeline import get_pipeline
            results["speakers"] = detect_all_turns(source_path, get_pipeline())

    finally:
        if is_temp:
            try:
                os.unlink(source_path)
            except FileNotFoundError:
                pass

    return results


@router.get("/health")
async def health():
    return {"status": "ok", "service": "analyzer-lab-edustudio"}
