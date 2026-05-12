"""Punto de entrada de la aplicación FastAPI.

El pipeline de pyannote se carga en background al arrancar para no bloquear
el puerto — Render hace timeout si el puerto no está abierto en ~60s y
pyannote tarda varios minutos en descargar/cargar el modelo.
"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.pipeline import initialize_pipeline
from src.router import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Carga pyannote en un thread para no bloquear el event loop ni el puerto
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, initialize_pipeline)
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
