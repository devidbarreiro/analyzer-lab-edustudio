"""Diarización de hablantes con pyannote/speaker-diarization-3.1.

Identifica quién habla y cuándo. El "speaker principal" (profesor) se
determina como el hablante con mayor tiempo total de habla acumulado.

Mejoras respecto al módulo original de svc-edustudio-analisis:
  - Devuelve un resumen por speaker (tiempo total, % del vídeo, etiqueta)
  - Expone is_main_speaker en cada turno para que la UI pueda colorearlos
  - Acepta cualquier URL HTTP/HTTPS (no solo Firebase)
"""

import os
import subprocess
import tempfile
from collections import defaultdict

from pyannote.audio import Pipeline

SR = 16_000


# --------------------------------------------------------------------------- #
# Helpers internos                                                             #
# --------------------------------------------------------------------------- #

def _is_url(source: str) -> bool:
    return source.startswith("http://") or source.startswith("https://")


def _prepare_audio(source: str) -> tuple[str, bool]:
    """Devuelve (ruta_audio, es_temporal).
    URLs se descargan y convierten a WAV mono; paths locales se pasan tal cual.
    """
    if not _is_url(source):
        return source, False

    f = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp = f.name
    f.close()
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", source, "-ac", "1", "-ar", str(SR), tmp],
            check=True, capture_output=True, timeout=600,
        )
    except Exception:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise
    return tmp, True


def _unwrap_annotation(diarization):
    """Extrae el objeto Annotation del output de pyannote (varios formatos posibles)."""
    if hasattr(diarization, "itertracks"):
        return diarization
    for attr in ("speaker_diarization", "diarization", "annotation"):
        if hasattr(diarization, attr):
            return getattr(diarization, attr)
    raise RuntimeError(f"No se puede extraer la anotación de {type(diarization).__name__}")


def _run_diarization(source: str, pipeline: Pipeline):
    audio_path, is_temp = _prepare_audio(source)
    try:
        raw = pipeline(audio_path)
    finally:
        if is_temp:
            try:
                os.unlink(audio_path)
            except FileNotFoundError:
                pass
    return _unwrap_annotation(raw)


def _fmt_time(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


# --------------------------------------------------------------------------- #
# Fusión y filtrado                                                            #
# --------------------------------------------------------------------------- #

def merge_speaker_turns(
    turns: list[tuple[str, float, float]],
    merge_gap_seconds: float = 2.0,
    min_duration_seconds: float = 3.0,
) -> list[tuple[str, float, float]]:
    """Fusiona turnos consecutivos del mismo speaker y elimina artefactos cortos."""
    merged: list[list] = []
    for speaker, start, end in turns:
        if (
            merged
            and merged[-1][0] == speaker
            and (start - merged[-1][2]) <= merge_gap_seconds
        ):
            merged[-1][2] = end
        else:
            merged.append([speaker, start, end])

    return [
        (spk, s, e)
        for spk, s, e in merged
        if (e - s) >= min_duration_seconds
    ]


# --------------------------------------------------------------------------- #
# API pública                                                                  #
# --------------------------------------------------------------------------- #

def detect_all_turns(
    source: str,
    pipeline: Pipeline,
    merge_gap_seconds: float = 2.0,
    min_duration_seconds: float = 3.0,
) -> dict:
    """Diarización completa: todos los hablantes con resumen y turnos.

    Returns:
        {
            "speakers": [
                {
                    "label":          str,    # SPEAKER_00, SPEAKER_01 ...
                    "total_seconds":  float,
                    "percentage":     float,  # % del tiempo total con voz
                    "is_main":        bool,   # True para el hablante principal
                    "turns_count":    int,
                }
            ],
            "turns": [
                {
                    "speaker":        str,
                    "start_seconds":  float,
                    "end_seconds":    float,
                    "duration_seconds": float,
                    "start_fmt":      str,
                    "end_fmt":        str,
                    "is_main":        bool,
                }
            ],
            "total_speech_seconds": float,
            "num_speakers":         int,
        }
    """
    annotation = _run_diarization(source, pipeline)

    raw = sorted(
        [
            (speaker, turn.start, turn.end)
            for turn, _, speaker in annotation.itertracks(yield_label=True)
        ],
        key=lambda x: x[1],
    )

    merged = merge_speaker_turns(raw, merge_gap_seconds, min_duration_seconds)

    # Tiempo total por speaker
    speaker_time: dict[str, float] = defaultdict(float)
    for spk, s, e in merged:
        speaker_time[spk] += e - s

    if not speaker_time:
        return {"speakers": [], "turns": [], "total_speech_seconds": 0.0, "num_speakers": 0}

    total_speech = sum(speaker_time.values())
    main_speaker = max(speaker_time, key=speaker_time.__getitem__)

    speakers = [
        {
            "label":         spk,
            "total_seconds": round(t, 2),
            "percentage":    round(100 * t / total_speech, 1) if total_speech else 0.0,
            "is_main":       spk == main_speaker,
            "turns_count":   sum(1 for s, _, _ in merged if s == spk),
        }
        for spk, t in sorted(speaker_time.items(), key=lambda x: -x[1])
    ]

    turns = [
        {
            "speaker":          spk,
            "start_seconds":    round(s, 3),
            "end_seconds":      round(e, 3),
            "duration_seconds": round(e - s, 3),
            "start_fmt":        _fmt_time(s),
            "end_fmt":          _fmt_time(e),
            "is_main":          spk == main_speaker,
        }
        for spk, s, e in merged
    ]

    return {
        "speakers":             speakers,
        "turns":                turns,
        "total_speech_seconds": round(total_speech, 2),
        "num_speakers":         len(speaker_time),
    }
