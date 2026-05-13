"""Configuración de la aplicación desde variables de entorno.

Variables requeridas:
- API_KEY        : cabecera Authorization para todos los endpoints protegidos
- HF_TOKEN       : token HuggingFace para descargar pyannote/speaker-diarization-3.1
- DATABASE_URL   : postgresql://user:pass@host:port/db
- S3_ENDPOINT_URL: URL del endpoint S3/R2/MinIO
- S3_ACCESS_KEY  : access key
- S3_SECRET_KEY  : secret key
- S3_BUCKET      : nombre del bucket

Variables opcionales:
- S3_PUBLIC_URL  : URL pública del bucket (si difiere del endpoint, p.ej. en Docker)
- ALLOWED_ORIGINS: orígenes CORS permitidos, separados por coma (default: localhost:3000)
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    api_key: str
    hf_token: str = ""
    allowed_origins: str = "http://localhost:3000"

    # Base de datos
    database_url: str = "postgresql://analyzer:analyzer@localhost:5432/analyzer"

    # Storage S3-compatible (MinIO en local, R2 en prod)
    s3_endpoint_url: str = "http://localhost:9000"
    s3_public_url: str = ""          # si está vacío usa s3_endpoint_url
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "videos"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def s3_base_url(self) -> str:
        """URL base pública para construir URLs de objetos."""
        base = self.s3_public_url or self.s3_endpoint_url
        return base.rstrip("/")


settings = Settings()
