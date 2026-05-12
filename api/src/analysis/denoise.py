"""Reducción de ruido de fondo y análisis comparativo antes/después.

Usa noisereduce (RNNoise-inspired, CPU-only) sobre el audio extraído del vídeo.
Devuelve métricas DNSMOS antes y después para que la UI pueda mostrar la mejora.

No modifica el fichero de vídeo original — solo analiza y reporta.
Si en el futuro se quiere exportar el audio limpio, se puede añadir un
endpoint /export-denoised que devuelva el WAV procesado.
"""

import os
import subprocess
import tempfile

import numpy as np
import librosa
import noisereduce as nr
import soundfile as sf
from speechmos import dnsmos

SR = 16_000
ANALYSIS_DURATION = 60  # segundos a analizar (desde el 25% del vídeo)


def _video_duration(source: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", source],
        capture_output=True, text=True, check=True,
    )
    return float(result.stdout.strip())


def _extract_wav(source: str, offset: float, duration: float, out: str) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(offset), "-t", str(duration),
         "-i", source, "-ac", "1", "-ar", str(SR), out],
        check=True, capture_output=True,
    )


def _dnsmos_scores(wav_path: str) -> dict:
    scores = dnsmos.run(wav_path, sr=SR)
    return {
        "sig_mos":  round(float(scores["sig_mos"]), 3),
        "bak_mos":  round(float(scores["bak_mos"]), 3),
        "ovrl_mos": round(float(scores["ovrl_mos"]), 3),
    }


def analyze_with_denoise(source: str) -> dict:
    """Extrae un fragmento de audio, aplica noisereduce y compara scores DNSMOS.

    Args:
        source: ruta local (en tempdir) o URL HTTP/HTTPS al vídeo.

    Returns:
        {
            "before":  {"sig_mos", "bak_mos", "ovrl_mos"},
            "after":   {"sig_mos", "bak_mos", "ovrl_mos"},
            "delta":   {"sig_mos", "bak_mos", "ovrl_mos"},  # after - before
            "improvement": float,    # delta ovrl_mos
            "worth_denoising": bool, # True si mejora > 0.15 puntos
            "analysis_offset_s": float,
            "analysis_duration_s": float,
        }
    """
    total = _video_duration(source)
    offset = total * 0.25
    duration = min(ANALYSIS_DURATION, total - offset)

    tmp_original = None
    tmp_denoised = None
    try:
        # Extraer fragmento original
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            tmp_original = f.name
        _extract_wav(source, offset, duration, tmp_original)

        # Scores antes
        scores_before = _dnsmos_scores(tmp_original)

        # Aplicar noisereduce
        audio, _ = librosa.load(tmp_original, sr=SR, mono=True)
        reduced = nr.reduce_noise(y=audio, sr=SR, stationary=False, prop_decrease=0.8)

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            tmp_denoised = f.name
        sf.write(tmp_denoised, reduced, SR)

        # Scores después
        scores_after = _dnsmos_scores(tmp_denoised)

    finally:
        for p in (tmp_original, tmp_denoised):
            if p:
                try:
                    os.unlink(p)
                except FileNotFoundError:
                    pass

    delta = {
        k: round(scores_after[k] - scores_before[k], 3)
        for k in scores_before
    }
    improvement = delta["ovrl_mos"]

    return {
        "before":               scores_before,
        "after":                scores_after,
        "delta":                delta,
        "improvement":          improvement,
        "worth_denoising":      improvement >= 0.15,
        "analysis_offset_s":    round(offset, 1),
        "analysis_duration_s":  round(duration, 1),
    }
