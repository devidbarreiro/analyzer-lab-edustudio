# Analyzer Lab · Edustudio

Herramienta de análisis de vídeo/audio para Edustudio. Sube un vídeo (o pasa una URL) y obtén:

- **Calidad de audio** — DNSMOS (SIG/BAK/OVRL MOS), SNR, peak, grade
- **Diarización de hablantes** — pyannote 3.1, timeline de turnos, % por hablante
- **Reducción de ruido** — comparativa antes/después con noisereduce

## Estructura

```
analyzer-lab-edustudio/
├── api/     FastAPI (Python) → deploy en Render
└── ui/      Next.js 16       → deploy en Vercel
```

## Arranque local

### API

```bash
cd api
cp .env.example .env       # rellena API_KEY y HF_TOKEN
pip install uv
uv pip install -e .
uvicorn src.main:app --reload
# → http://localhost:8000
```

> La primera vez tarda ~30s descargando pyannote desde HuggingFace.

### UI

```bash
cd ui
cp .env.local.example .env.local   # apunta a http://localhost:8000
npm install
npm run dev
# → http://localhost:3000
```

## Variables de entorno

### API (`api/.env`)
| Variable | Descripción |
|---|---|
| `API_KEY` | Clave secreta para `Authorization: Bearer <key>` |
| `HF_TOKEN` | Token HuggingFace — acepta los términos de [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1) |
| `ALLOWED_ORIGINS` | CORS — URLs del frontend separadas por coma |

### UI (`ui/.env.local`)
| Variable | Descripción |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL de la API (ej. `https://tu-api.onrender.com`) |
| `NEXT_PUBLIC_API_KEY` | Mismo valor que `API_KEY` en la API |

## Deploy

### Render (API)
1. Conecta el repo en [render.com](https://render.com)
2. Selecciona la carpeta `api/`
3. Rellena las env vars `API_KEY` y `HF_TOKEN` en el dashboard
4. El `render.yaml` ya tiene la configuración

### Vercel (UI)
1. Conecta el repo en [vercel.com](https://vercel.com)
2. Selecciona la carpeta `ui/` como root
3. Añade `NEXT_PUBLIC_API_URL` y `NEXT_PUBLIC_API_KEY` en las variables de entorno

## Endpoint

```
POST /analyze
Authorization: Bearer <API_KEY>
Content-Type: multipart/form-data

file   (File)    vídeo/audio — upload directo
url    (string)  URL del vídeo — alternativa a file
steps  (string)  quality,speakers,denoise  (coma-separados, default: todos)
label  (string)  nombre descriptivo (opcional)
```
