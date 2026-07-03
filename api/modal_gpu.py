"""Modal GPU: full analysis pipeline for EduStudio Analyzer.

Runs quality + silence + denoise + speakers on Modal with GPU.
Tracks cost and timing per step for full traceability.

Deploy:  modal deploy api/modal_gpu.py
Test:    modal run api/modal_gpu.py --url "https://..."
"""

import modal

app = modal.App("analyzer-edustudio")

gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "torch",
        "torchaudio",
        "pyannote.audio",
        "huggingface_hub",
        "librosa",
        "speechmos",
        "onnxruntime",
        "noisereduce",
        "soundfile",
        "numpy",
    )
)

COST_PER_SECOND_T4 = 0.000164  # $0.59/h = $0.000164/s


@app.cls(
    image=gpu_image,
    gpu="T4",
    timeout=1800,
    secrets=[modal.Secret.from_name("huggingface")],
    scaledown_window=300,
)
class Analyzer:

    @modal.enter()
    def load_models(self):
        import os
        import torch
        from pyannote.audio import Pipeline

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print(f"[modal] Loading pyannote on {device}...", flush=True)
        self.pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=os.environ["HF_TOKEN"],
        ).to(device)
        self.device = device
        print("[modal] Models ready.", flush=True)

    @modal.method()
    def run_pipeline(self, video_bytes: bytes = b"", video_path: str = "", steps: list[str] = []) -> dict:
        import os
        import time
        import subprocess
        import tempfile
        import re
        from collections import defaultdict

        import numpy as np
        import librosa
        from speechmos import dnsmos

        t_total_start = time.time()
        results = {"steps_run": steps, "costs": {}, "timings": {}}
        SR = 16000

        # Resolve video to local temp file
        if video_bytes:
            tmp_video = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
            tmp_video.write(video_bytes)
            tmp_video.close()
            source = tmp_video.name
        elif video_path and video_path.startswith("http"):
            import urllib.request
            tmp_video = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
            tmp_video.close()
            print(f"[modal] Downloading video from URL...", flush=True)
            urllib.request.urlretrieve(video_path, tmp_video.name)
            source = tmp_video.name
            print(f"[modal] Download OK ({os.path.getsize(source) / 1e6:.1f}MB)", flush=True)
        elif video_path:
            source = video_path
        else:
            return {"error": "No video provided"}

        # Get duration
        dur_result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", source],
            capture_output=True, text=True, check=True,
        )
        total_duration = float(dur_result.stdout.strip())
        results["video_duration_s"] = round(total_duration, 1)

        # ── QUALITY ──────────────────────────────────────────────
        if "quality" in steps:
            t0 = time.time()

            SAMPLE_POINTS = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95]
            clips = []
            all_audio = []

            for p in SAMPLE_POINTS:
                off = total_duration * p
                dur = min(30, total_duration - off)
                if dur <= 0:
                    continue
                tmp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
                tmp_wav.close()
                try:
                    subprocess.run(
                        ["ffmpeg", "-y", "-ss", str(off), "-t", str(dur),
                         "-i", source, "-ac", "1", "-ar", str(SR), tmp_wav.name],
                        check=True, capture_output=True,
                    )
                    audio, _ = librosa.load(tmp_wav.name, sr=SR, mono=True)
                    scores = dnsmos.run(tmp_wav.name, sr=SR)
                    clips.append({
                        "sig": float(scores["sig_mos"]),
                        "bak": float(scores["bak_mos"]),
                        "ovrl": float(scores["ovrl_mos"]),
                    })
                    all_audio.append(audio)
                finally:
                    os.unlink(tmp_wav.name)

            # Peak detection
            peak_db = None
            peak_result = subprocess.run(
                ["ffmpeg", "-y", "-i", source, "-af", "volumedetect", "-f", "null", "/dev/null"],
                capture_output=True, text=True, timeout=300,
            )
            for line in peak_result.stderr.splitlines():
                if "max_volume" in line:
                    parts = line.split("max_volume:")
                    if len(parts) == 2:
                        try:
                            peak_db = float(parts[1].strip().replace("dB", "").strip())
                        except ValueError:
                            pass

            # SNR
            combined = np.concatenate(all_audio) if all_audio else np.array([])
            snr = 0.0
            if len(combined) > 512:
                frames = librosa.util.frame(combined, frame_length=512, hop_length=256)
                energies = np.sum(frames ** 2, axis=0)
                noise_floor = np.percentile(energies, 10)
                snr = round(10 * np.log10(np.mean(energies) / noise_floor), 1) if noise_floor > 0 else 99.0

            avg_ovrl = round(float(np.mean([c["ovrl"] for c in clips])), 3) if clips else 0
            grade = "Excelente" if avg_ovrl >= 4.0 else "Buena" if avg_ovrl >= 3.5 else "Aceptable" if avg_ovrl >= 3.0 else "Mejorar"

            elapsed = time.time() - t0
            results["quality"] = {
                "duration_s": round(total_duration, 1),
                "sig_mos": round(float(np.mean([c["sig"] for c in clips])), 3) if clips else 0,
                "bak_mos": round(float(np.mean([c["bak"] for c in clips])), 3) if clips else 0,
                "ovrl_mos": avg_ovrl,
                "snr_db": snr,
                "peak_db": peak_db,
                "clipping": peak_db is not None and peak_db >= -1.0,
                "grade": grade,
                "samples": clips,
            }
            results["timings"]["quality"] = round(elapsed, 2)
            results["costs"]["quality"] = round(elapsed * COST_PER_SECOND_T4, 6)

        # ── SILENCE ──────────────────────────────────────────────
        if "quality" in steps:
            t0 = time.time()
            silence_result = subprocess.run(
                ["ffmpeg", "-y", "-i", source,
                 "-af", "silencedetect=noise=-40dB:d=2.0",
                 "-f", "null", "/dev/null"],
                capture_output=True, text=True, timeout=600,
            )
            output = silence_result.stderr
            start_re = re.compile(r"silence_start:\s*([\d.]+)")
            end_re = re.compile(r"silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)")
            starts = [float(m.group(1)) for m in start_re.finditer(output)]
            ends = [(float(m.group(1)), float(m.group(2))) for m in end_re.finditer(output)]

            def fmt_t(s):
                m, sec = divmod(int(s), 60)
                h, m = divmod(m, 60)
                return f"{h}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"

            silences = []
            for i, (end_s, dur_s) in enumerate(ends):
                start_s = starts[i] if i < len(starts) else end_s - dur_s
                silences.append({
                    "start_s": round(start_s, 2), "end_s": round(end_s, 2),
                    "duration_s": round(dur_s, 2),
                    "start_fmt": fmt_t(start_s), "end_fmt": fmt_t(end_s),
                })
            total_silence = sum(s["duration_s"] for s in silences)

            elapsed = time.time() - t0
            results["silences"] = {
                "silences": silences,
                "total_silence_s": round(total_silence, 2),
                "silence_percentage": round(100 * total_silence / total_duration, 1) if total_duration else 0,
                "num_silences": len(silences),
            }
            results["timings"]["silence"] = round(elapsed, 2)
            results["costs"]["silence"] = round(elapsed * COST_PER_SECOND_T4, 6)

        # ── DENOISE ──────────────────────────────────────────────
        if "denoise" in steps:
            t0 = time.time()
            import noisereduce as nr
            import soundfile as sf

            offset = total_duration * 0.25
            duration = min(60, total_duration - offset)
            tmp_orig = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            tmp_orig.close()
            tmp_dn = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            tmp_dn.close()

            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-ss", str(offset), "-t", str(duration),
                     "-i", source, "-ac", "1", "-ar", str(SR), tmp_orig.name],
                    check=True, capture_output=True,
                )
                scores_before = dnsmos.run(tmp_orig.name, sr=SR)
                audio, _ = librosa.load(tmp_orig.name, sr=SR, mono=True)
                reduced = nr.reduce_noise(y=audio, sr=SR, stationary=False, prop_decrease=0.8)
                sf.write(tmp_dn.name, reduced, SR)
                scores_after = dnsmos.run(tmp_dn.name, sr=SR)
            finally:
                for p in (tmp_orig.name, tmp_dn.name):
                    try:
                        os.unlink(p)
                    except FileNotFoundError:
                        pass

            before = {k: round(float(scores_before[k]), 3) for k in ["sig_mos", "bak_mos", "ovrl_mos"]}
            after = {k: round(float(scores_after[k]), 3) for k in ["sig_mos", "bak_mos", "ovrl_mos"]}
            delta = {k: round(after[k] - before[k], 3) for k in before}

            elapsed = time.time() - t0
            results["denoise"] = {
                "before": before, "after": after, "delta": delta,
                "improvement": delta["ovrl_mos"],
                "worth_denoising": delta["ovrl_mos"] >= 0.15,
            }
            results["timings"]["denoise"] = round(elapsed, 2)
            results["costs"]["denoise"] = round(elapsed * COST_PER_SECOND_T4, 6)

        # ── SPEAKERS ─────────────────────────────────────────────
        if "speakers" in steps:
            t0 = time.time()

            tmp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            tmp_wav.close()
            subprocess.run(
                ["ffmpeg", "-y", "-i", source, "-ac", "1", "-ar", str(SR), tmp_wav.name],
                check=True, capture_output=True, timeout=300,
            )

            diarization = self.pipeline(tmp_wav.name)
            os.unlink(tmp_wav.name)

            if not hasattr(diarization, "itertracks"):
                for attr in ("speaker_diarization", "diarization", "annotation"):
                    if hasattr(diarization, attr):
                        diarization = getattr(diarization, attr)
                        break

            raw = sorted(
                [(spk, turn.start, turn.end) for turn, _, spk in diarization.itertracks(yield_label=True)],
                key=lambda x: x[1],
            )

            # Merge
            merged = []
            for speaker, start, end in raw:
                if merged and merged[-1][0] == speaker and (start - merged[-1][2]) <= 2.0:
                    merged[-1] = (speaker, merged[-1][1], end)
                else:
                    merged.append((speaker, start, end))
            filtered = [(s, st, en) for s, st, en in merged if (en - st) >= 3.0]

            speaker_time = defaultdict(float)
            for spk, s, e in filtered:
                speaker_time[spk] += e - s
            total_speech = sum(speaker_time.values())
            main_speaker = max(speaker_time, key=speaker_time.__getitem__) if speaker_time else None

            speakers_summary = [
                {
                    "label": spk, "total_seconds": round(t, 2),
                    "percentage": round(100 * t / total_speech, 1) if total_speech else 0,
                    "is_main": spk == main_speaker,
                    "turns_count": sum(1 for s, _, _ in filtered if s == spk),
                }
                for spk, t in sorted(speaker_time.items(), key=lambda x: -x[1])
            ]

            turns = [
                {
                    "speaker": spk, "start_seconds": round(s, 3), "end_seconds": round(e, 3),
                    "duration_seconds": round(e - s, 3),
                    "start_fmt": fmt_t(s), "end_fmt": fmt_t(e),
                    "is_main": spk == main_speaker,
                }
                for spk, s, e in filtered
            ]

            elapsed = time.time() - t0
            results["speakers"] = {
                "speakers": speakers_summary, "turns": turns,
                "total_speech_seconds": round(total_speech, 2),
                "num_speakers": len(speaker_time),
            }
            results["timings"]["speakers"] = round(elapsed, 2)
            results["costs"]["speakers"] = round(elapsed * COST_PER_SECOND_T4, 6)

        # ── CLEANUP ───────────────────────────────────────────────
        if source.startswith("/tmp") and os.path.exists(source):
            os.unlink(source)

        # ── TOTALS ───────────────────────────────────────────────
        total_elapsed = time.time() - t_total_start
        results["timings"]["total"] = round(total_elapsed, 2)
        results["costs"]["total"] = round(total_elapsed * COST_PER_SECOND_T4, 6)
        results["device"] = str(self.device)

        return results


@app.local_entrypoint()
def main(url: str = "", steps: str = "quality,speakers,denoise"):
    if not url:
        print("Usage: modal run api/modal_gpu.py --url <video_url> [--steps quality,speakers,denoise]")
        return
    import json
    analyzer = Analyzer()
    result = analyzer.run_pipeline.remote(video_path=url, steps=steps.split(","))
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if "costs" in result:
        print(f"\n💰 Cost breakdown:")
        for step, cost in result["costs"].items():
            print(f"  {step}: ${cost:.6f}")
