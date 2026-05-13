"""Cliente S3-compatible (MinIO en local, Cloudflare R2 en prod).

Expone:
  - presigned_upload_url(key, size)  → URL para que el browser suba directamente
  - presigned_download_url(key)      → URL temporal para descargar/reproducir
  - delete_object(key)
  - download_to_tmp(key)             → descarga a fichero temporal para el worker
"""

import os
import tempfile

import boto3
from botocore.client import Config

from src.config import settings

# Cliente S3 — se crea una vez al importar el módulo
_s3 = boto3.client(
    "s3",
    endpoint_url=settings.s3_endpoint_url,
    aws_access_key_id=settings.s3_access_key,
    aws_secret_access_key=settings.s3_secret_key,
    config=Config(signature_version="s3v4"),
    region_name="auto",
)


def presigned_upload_url(key: str, content_type: str = "application/octet-stream", expires: int = 3600) -> str:
    """Genera una presigned PUT URL para que el cliente suba directamente al bucket.

    expires: segundos de validez (default 1h — suficiente para ficheros grandes)
    """
    url = _s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=expires,
        HttpMethod="PUT",
    )
    # En Docker, el endpoint interno es minio:9000 pero el browser
    # necesita localhost:9000 — reemplazamos el host si S3_PUBLIC_URL difiere
    if settings.s3_public_url and settings.s3_public_url != settings.s3_endpoint_url:
        url = url.replace(settings.s3_endpoint_url, settings.s3_public_url, 1)
    return url


def presigned_download_url(key: str, expires: int = 3600) -> str:
    """Genera una presigned GET URL para descargar/reproducir el vídeo."""
    url = _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=expires,
    )
    if settings.s3_public_url and settings.s3_public_url != settings.s3_endpoint_url:
        url = url.replace(settings.s3_endpoint_url, settings.s3_public_url, 1)
    return url


def delete_object(key: str) -> None:
    _s3.delete_object(Bucket=settings.s3_bucket, Key=key)


def download_to_tmp(key: str) -> str:
    """Descarga el objeto a un fichero temporal. Devuelve el path.

    El llamante es responsable de borrar el fichero cuando termine.
    """
    ext = os.path.splitext(key)[1] or ".mp4"
    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    tmp.close()
    _s3.download_file(settings.s3_bucket, key, tmp.name)
    return tmp.name
