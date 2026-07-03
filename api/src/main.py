"""Punto de entrada de la aplicación FastAPI.

El pipeline de pyannote se carga en background al arrancar para no bloquear
el puerto — Render hace timeout si el puerto no está abierto en ~60s y
pyannote tarda varios minutos en descargar/cargar el modelo.
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.db import close_db, init_db
from src.router import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inicializar DB (crea tablas si no existen)
    init_db()
    # pyannote/torch se cargan bajo demanda al procesar el primer job
    # para no consumir RAM en el arranque (Render starter = 512MB)
    yield
    close_db()


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
