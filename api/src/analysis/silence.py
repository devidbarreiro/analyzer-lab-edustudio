"""Detección de silencios largos en audio/vídeo.

Usa ffmpeg silencedetect para encontrar tramos sin actividad vocal.
No requiere modelos ML — es un filtro de energía de señal puro.

Devuelve lista de silencios con start/end/duration, y un resumen
con tiempo total en silencio y porcentaje sobre la duración total.
"""

import subprocess
import re


def detect_silences(
    source: str,
    min_duration_s: float = 2.0,
    noise_db: float = -40.0,
) -> dict:
    """Detecta silencios largos en el audio de un vídeo.

    Args:
        source:          ruta local o URL del vídeo.
        min_duration_s:  duración mínima en segundos para considerar un silencio.
        noise_db:        umbral de energía en dB — por debajo de este valor
                         se considera silencio. -40 dB es conservador (solo
                         silencios reales), -30 dB más agresivo.

    Returns:
        {
            "silences": [
                {"start_s": float, "end_s": float, "duration_s": float,
                 "start_fmt": str, "end_fmt": str}
            ],
            "total_silence_s":   float,
            "silence_percentage": float,   # % sobre duración total
            "num_silences":      int,
            "min_duration_s":    float,    # umbral usado
            "noise_db":          float,
        }
    """
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", source,
            "-af", f"silencedetect=noise={noise_db}dB:d={min_duration_s}",
            "-f", "null", "/dev/null",
        ],
        capture_output=True, text=True, timeout=600,
    )

    output = result.stderr
    silences = []

    start_re = re.compile(r"silence_start:\s*([\d.]+)")
    end_re   = re.compile(r"silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)")

    starts = [float(m.group(1)) for m in start_re.finditer(output)]
    ends   = [(float(m.group(1)), float(m.group(2))) for m in end_re.finditer(output)]

    for i, (end_s, dur_s) in enumerate(ends):
        start_s = starts[i] if i < len(starts) else end_s - dur_s
        silences.append({
            "start_s":    round(start_s, 2),
            "end_s":      round(end_s, 2),
            "duration_s": round(dur_s, 2),
            "start_fmt":  _fmt(start_s),
            "end_fmt":    _fmt(end_s),
        })

    # Silencio sin end (hasta el final del vídeo)
    if len(starts) > len(ends):
        start_s = starts[-1]
        # Obtener duración total para calcular el end
        dur_result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", source],
            capture_output=True, text=True,
        )
        try:
            total = float(dur_result.stdout.strip())
            silences.append({
                "start_s":    round(start_s, 2),
                "end_s":      round(total, 2),
                "duration_s": round(total - start_s, 2),
                "start_fmt":  _fmt(start_s),
                "end_fmt":    _fmt(total),
            })
        except ValueError:
            pass

    total_silence = sum(s["duration_s"] for s in silences)

    # Duración total del vídeo para calcular porcentaje
    dur_result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", source],
        capture_output=True, text=True,
    )
    try:
        total_duration = float(dur_result.stdout.strip())
    except ValueError:
        total_duration = 0.0

    return {
        "silences":           silences,
        "total_silence_s":    round(total_silence, 2),
        "silence_percentage": round(100 * total_silence / total_duration, 1) if total_duration else 0.0,
        "num_silences":       len(silences),
        "min_duration_s":     min_duration_s,
        "noise_db":           noise_db,
    }


def _fmt(s: float) -> str:
    m, sec = divmod(int(s), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m:02d}:{sec:02d}"
