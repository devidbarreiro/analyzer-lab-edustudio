# Despliegue en VPS (Hetzner)

## Setup completo en nuevo servidor

```bash
# 1. Copiar proyecto desde Mac
rsync -av --exclude='node_modules' --exclude='.next' --exclude='__pycache__' --exclude='.git' --exclude='.venv' /Users/david/dev/analyzer-lab-edustudio root@<nueva-ip>:/root/

# 2. Instalar Docker y nginx
apt update && curl -fsSL https://get.docker.com | sh && apt install nginx -y

# 3. Configurar nginx
cp /root/analyzer-lab-edustudio/nginx.conf /etc/nginx/sites-available/analyzer
ln -s /etc/nginx/sites-available/analyzer /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# 4. Levantar stack
cd /root/analyzer-lab-edustudio
ALLOWED_ORIGINS=http://<nueva-ip> S3_PUBLIC_URL=http://<nueva-ip>:9000 docker compose up --build -d
```

## Notas importantes

- El modelo de pyannote (diarización) se descarga la primera vez que se procesa un job con `speakers`. Tarda ~5 min y pesa ~1GB. Las siguientes veces usa caché.
- En CPU (sin GPU) la diarización de un vídeo de 100MB tarda ~70 minutos. Con GPU (RunPod RTX A4500) tardaría ~1 min.
- El VPS mínimo recomendado es **CX31 (8GB RAM)**. Con 4GB peta al cargar pyannote.
- Hetzner cobra por horas aunque el servidor esté apagado. Para dejar de pagar hay que **eliminar el servidor** (el disco y datos se pierden).

## Variables de entorno clave

Todas las variables se definen en `.env` (ver `.env.example`). **Nunca hardcodear secretos en compose ni en código.**

| Variable | Descripción |
|---|---|
| `POSTGRES_PASSWORD` | Contraseña de la BD (user `analyzer`) |
| `MINIO_ROOT_USER` | Usuario admin de MinIO |
| `MINIO_ROOT_PASSWORD` | Contraseña admin de MinIO |
| `API_KEY` | Clave de autenticación de la API |
| `HF_TOKEN` | Token de HuggingFace (pyannote) |
| `MODAL_TOKEN_ID` | Token ID de Modal (solo prod) |
| `MODAL_TOKEN_SECRET` | Token secret de Modal (solo prod) |
| `ALLOWED_ORIGINS` | Default: `http://localhost:3929` (dev) / `https://analyzer.ailumtech.com` (prod) |
| `S3_PUBLIC_URL` | Default: `http://localhost:9000` (dev) / `https://s3-analyzer.ailumtech.com` (prod) |

## Puertos

| Servicio | Puerto |
|---|---|
| UI (Next.js) | `3929` → acceso por `http://<ip>` via nginx |
| API (FastAPI) | `8000` → acceso por `http://<ip>/api/` via nginx |
| MinIO S3 | `9000` → acceso directo para presigned URLs |
| MinIO consola | `9001` |
| Postgres | `5432` |
