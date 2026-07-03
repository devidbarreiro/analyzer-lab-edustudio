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

# Cliente S3 interno — para operaciones server-side (download, delete, etc.)
_s3 = boto3.client(
    "s3",
    endpoint_url=settings.s3_endpoint_url,
    aws_access_key_id=settings.s3_access_key,
    aws_secret_access_key=settings.s3_secret_key,
    config=Config(signature_version="s3v4"),
    region_name="auto",
)

# Cliente S3 público — para generar presigned URLs con el host externo
_public_url = settings.s3_public_url or settings.s3_endpoint_url
_s3_public = boto3.client(
    "s3",
    endpoint_url=_public_url,
    aws_access_key_id=settings.s3_access_key,
    aws_secret_access_key=settings.s3_secret_key,
    config=Config(signature_version="s3v4"),
    region_name="auto",
)


def presigned_upload_url(key: str, content_type: str = "application/octet-stream", expires: int = 7200) -> str:
    """Genera una presigned PUT URL para que el cliente suba directamente al bucket."""
    return _s3_public.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=expires,
        HttpMethod="PUT",
    )


def presigned_download_url(key: str, expires: int = 7200) -> str:
    """Genera una presigned GET URL para descargar/reproducir el vídeo."""
    return _s3_public.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=expires,
    )


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
