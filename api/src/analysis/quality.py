"""Análisis perceptual de calidad de audio usando DNSMOS.

Toma 5 muestras de 30s en posiciones 10/25/50/75/90% del vídeo y promedia
los scores. Acepta rutas locales (dentro de tempdir) y URLs HTTP/HTTPS.

DNSMOS produce tres métricas en escala 1–5:
  - SIG  : calidad de la señal de voz (Speech signal quality)
  - BAK  : calidad del ruido de fondo (Background noise quality)
  - OVRL : calidad global perceptual

Además se calcula:
  - SNR  : estimación de relación señal/ruido (dB) via librosa
  - Peak : nivel pico máximo (dB) via ffmpeg volumedetect — indica clipping
"""

import os
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import librosa
from speechmos import dnsmos

SR = 16_000
SAMPLE_DURATION = 30
SAMPLE_POINTS = [0.10, 0.25, 0.50, 0.75, 0.90]


# --------------------------------------------------------------------------- #
# Helpers internos                                                             #
# --------------------------------------------------------------------------- #

def _video_duration(source: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", source],
        capture_output=True, text=True, check=True,
    )
    return float(result.stdout.strip())


def _extract_clip(source: str, offset: float, duration: float, out_wav: str) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(offset), "-t", str(duration),
         "-i", source, "-ac", "1", "-ar", str(SR), out_wav],
        check=True, capture_output=True,
    )


def _estimate_snr(audio: np.ndarray) -> float:
    frames = librosa.util.frame(audio, frame_length=512, hop_length=256)
    energies = np.sum(frames ** 2, axis=0)
    noise_floor = np.percentile(energies, 10)
    if noise_floor <= 0:
        return 99.0
    return round(10 * np.log10(np.mean(energies) / noise_floor), 1)


def _check_peak(source: str) -> float | None:
    """Devuelve el nivel pico en dB (float) o None si no se puede calcular."""
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", source, "-af", "volumedetect", "-f", "null", "/dev/null"],
        capture_output=True, text=True, timeout=300,
    )
    for line in result.stderr.splitlines():
        if "max_volume" in line:
            parts = line.split("max_volume:")
            if len(parts) == 2:
                try:
                    return float(parts[1].strip().replace("dB", "").strip())
                except ValueError:
                    pass
    return None


def _grade(ovrl: float) -> str:
    if ovrl >= 4.0:
        return "Excelente"
    if ovrl >= 3.5:
        return "Buena"
    if ovrl >= 3.0:
        return "Aceptable"
    return "Mejorar"


def _analyze_clip(source: str, offset: float, label: str, duration: float = SAMPLE_DURATION) -> dict:
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            tmp = f.name
        _extract_clip(source, offset, duration, tmp)
        audio, _ = librosa.load(tmp, sr=SR, mono=True)
        scores = dnsmos.run(tmp, sr=SR)
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except FileNotFoundError:
                pass
    return {
        "label": label,
        "audio": audio,
        "sig": float(scores["sig_mos"]),
        "bak": float(scores["bak_mos"]),
        "ovrl": float(scores["ovrl_mos"]),
    }


# --------------------------------------------------------------------------- #
# API pública                                                                  #
# --------------------------------------------------------------------------- #

def analyze(source: str, label: str | None = None) -> dict:
    """Análisis completo de calidad de audio de un vídeo/audio.

    Args:
        source: ruta local (en tempdir) o URL HTTP/HTTPS al fichero.
        label:  nombre descriptivo para el informe (por defecto: nombre de fichero).

    Returns:
        Dict con métricas de calidad:
        {
            "file":         str,
            "duration_s":   float,
            "sig_mos":      float,   # 1–5
            "bak_mos":      float,   # 1–5
            "ovrl_mos":     float,   # 1–5
            "snr_db":       float,
            "peak_db":      float | None,
            "clipping":     bool,
            "grade":        str,     # Excelente / Buena / Aceptable / Mejorar
            "samples":      list[dict],  # score por cada muestra
        }
    """
    total = _video_duration(source)
    display_name = label or Path(source).name

    # Calcula offsets únicos (vídeos muy cortos pueden colapsar puntos)
    seen, unique_offsets = set(), []
    for p, lbl in zip(SAMPLE_POINTS, ["10%", "25%", "50%", "75%", "90%"]):
        off = total * p
        key = round(off, 0)
        if key not in seen and off < total:
            seen.add(key)
            unique_offsets.append((off, min(SAMPLE_DURATION, total - off), lbl))

    clips, all_audio = [], []
    for off, dur, lbl in unique_offsets:
        clip = _analyze_clip(source, off, lbl, dur)
        clips.append(clip)
        all_audio.append(clip["audio"])

    combined = np.concatenate(all_audio)
    avg_sig  = round(float(np.mean([c["sig"]  for c in clips])), 3)
    avg_bak  = round(float(np.mean([c["bak"]  for c in clips])), 3)
    avg_ovrl = round(float(np.mean([c["ovrl"] for c in clips])), 3)

    peak = _check_peak(source)

    return {
        "file":       display_name,
        "duration_s": round(total, 1),
        "sig_mos":    avg_sig,
        "bak_mos":    avg_bak,
        "ovrl_mos":   avg_ovrl,
        "snr_db":     _estimate_snr(combined),
        "peak_db":    peak,
        "clipping":   peak is not None and peak >= -1.0,
        "grade":      _grade(avg_ovrl),
        "samples": [
            {"position": c["label"], "ovrl": round(c["ovrl"], 3),
             "sig": round(c["sig"], 3), "bak": round(c["bak"], 3)}
            for c in clips
        ],
    }
