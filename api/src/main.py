"""Punto de entrada de la aplicación FastAPI.

Lifespan:
  1. Carga el pipeline de pyannote (~30s la primera vez, descarga el modelo)
  2. Monta los routers
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.pipeline import initialize_pipeline
from src.router import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    initialize_pipeline()
    yield
    # Shutdown (nada que limpiar por ahora)


app = FastAPI(
    title="Analyzer Lab Edustudio",
    description="API de análisis de audio/vídeo: calidad DNSMOS, diarización de hablantes, reducción de ruido.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
