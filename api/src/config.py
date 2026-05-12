"""Configuración de la aplicación desde variables de entorno.

Variables requeridas:
- API_KEY        : cabecera Authorization para todos los endpoints protegidos
- HF_TOKEN       : token HuggingFace para descargar pyannote/speaker-diarization-3.1

Variables opcionales:
- ALLOWED_ORIGINS: orígenes CORS permitidos, separados por coma (default: localhost:3000)
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    api_key: str
    hf_token: str
    allowed_origins: str = "http://localhost:3000"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
