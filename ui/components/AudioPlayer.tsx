"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Play, Pause, Volume2, VolumeX } from "lucide-react"
import type { QualityResult, SpeakersResult, DenoiseResult, SilencesResult } from "@/lib/types"

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, "0")}`
}

// DNSMOS OVRL → color  (1–5 scale, red→amber→green)
function mosColor(ovrl: number, alpha = 1): string {
  if (ovrl >= 4.0) return `rgba(16,185,129,${alpha})`   // emerald
  if (ovrl >= 3.5) return `rgba(59,130,246,${alpha})`   // blue
  if (ovrl >= 3.0) return `rgba(245,158,11,${alpha})`   // amber
  return `rgba(239,68,68,${alpha})`                      // red
}

const SPEAKER_COLORS = [
  "#3b82f6", "#8b5cf6", "#f59e0b",
  "#10b981", "#f43f5e", "#06b6d4",
]

// ─── types ───────────────────────────────────────────────────────────────────

interface Props {
  source: File | string
  duration: number
  quality?: QualityResult
  speakers?: SpeakersResult
  denoise?: DenoiseResult
  silences?: SilencesResult
}

// ─── component ───────────────────────────────────────────────────────────────

export default function AudioPlayer({ source, duration, quality, speakers, denoise, silences }: Props) {
  const audioRef   = useRef<HTMLAudioElement>(null)
  const waveCanvas = useRef<HTMLCanvasElement>(null)
  const ctxRef     = useRef<AudioContext | null>(null)
  const sourceUrl  = useRef<string>("")

  const [playing,    setPlaying]    = useState(false)
  const [muted,      setMuted]      = useState(false)
  const [currentT,   setCurrentT]   = useState(0)
  const [waveData,   setWaveData]   = useState<Float32Array | null>(null)
  const [loadingWave, setLoadingWave] = useState(true)
  const rafRef = useRef<number>(0)

  // ── build object URL from File or use raw URL ──────────────────────────────
  useEffect(() => {
    if (source instanceof File) {
      const url = URL.createObjectURL(source)
      sourceUrl.current = url
      if (audioRef.current) audioRef.current.src = url
      return () => URL.revokeObjectURL(url)
    } else {
      sourceUrl.current = source
      if (audioRef.current) audioRef.current.src = source
    }
  }, [source])

  // ── decode waveform via Web Audio API ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoadingWave(true)

    const decode = async () => {
      try {
        const ctx = new AudioContext()
        ctxRef.current = ctx

        let buffer: ArrayBuffer
        if (source instanceof File) {
          buffer = await source.arrayBuffer()
        } else {
          const res = await fetch(source)
          buffer = await res.arrayBuffer()
        }
        if (cancelled) return

        const decoded = await ctx.decodeAudioData(buffer)
        if (cancelled) return

        // Downsample to ~2000 points for the canvas
        const raw = decoded.getChannelData(0)
        const samples = 2000
        const blockSize = Math.floor(raw.length / samples)
        const down = new Float32Array(samples)
        for (let i = 0; i < samples; i++) {
          let sum = 0
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(raw[i * blockSize + j])
          }
          down[i] = sum / blockSize
        }
        setWaveData(down)
      } catch {
        // Audio decode failed (e.g. CORS on URL) — show flat line
        setWaveData(new Float32Array(2000).fill(0.1))
      } finally {
        if (!cancelled) setLoadingWave(false)
      }
    }

    decode()
    return () => { cancelled = true }
  }, [source])

  // ── draw canvas ────────────────────────────────────────────────────────────
  const drawCanvas = useCallback(() => {
    const canvas = waveCanvas.current
    if (!canvas || !waveData) return
    const W = canvas.width
    const H = canvas.height
    const ctx = canvas.getContext("2d")!
    ctx.clearRect(0, 0, W, H)

    // ── 1. DNSMOS heatmap continuo (background interpolado) ──────────────
    if (quality?.samples && quality.samples.length > 0) {
      const n = quality.samples.length
      // posiciones reales: 5,15,25,...95% distribuidas uniformemente
      const positions = quality.samples.map((_, i) => (i + 0.5) / n)

      // extender con primer y último valor para cubrir los extremos
      const pts = [
        { x: 0,   ovrl: quality.samples[0].ovrl },
        ...quality.samples.map((s, i) => ({ x: positions[i], ovrl: s.ovrl })),
        { x: 1,   ovrl: quality.samples[n - 1].ovrl },
      ]

      // pintar pixel a pixel interpolando linealmente entre puntos
      const imgData = ctx.createImageData(W, H)
      for (let px = 0; px < W; px++) {
        const ratio = px / W
        // encontrar segmento
        let i = 0
        while (i < pts.length - 2 && pts[i + 1].x < ratio) i++
        const t = pts[i + 1].x === pts[i].x ? 0
          : (ratio - pts[i].x) / (pts[i + 1].x - pts[i].x)
        const ovrl = pts[i].ovrl + t * (pts[i + 1].ovrl - pts[i].ovrl)

        // color según ovrl
        let r = 0, g = 0, b = 0
        if (ovrl >= 4.0)      { r = 16;  g = 185; b = 129 } // emerald
        else if (ovrl >= 3.5) { r = 59;  g = 130; b = 246 } // blue
        else if (ovrl >= 3.0) { r = 245; g = 158; b = 11  } // amber
        else                  { r = 239; g = 68;  b = 68  } // red

        for (let py = 0; py < H; py++) {
          const idx = (py * W + px) * 4
          imgData.data[idx]     = r
          imgData.data[idx + 1] = g
          imgData.data[idx + 2] = b
          imgData.data[idx + 3] = 38  // alpha ~15%
        }
      }
      ctx.putImageData(imgData, 0, 0)
    }

    // ── 2. waveform bars ───────────────────────────────────────────────────
    const maxAmp = Math.max(...Array.from(waveData), 0.001)
    const barW = W / waveData.length
    const mid = H / 2

    for (let i = 0; i < waveData.length; i++) {
      const x = i * barW
      const h = (waveData[i] / maxAmp) * (H * 0.42)
      const progress = i / waveData.length
      const played = duration > 0 ? currentT / duration : 0

      ctx.fillStyle = progress < played ? "#3b82f6" : "#d1d5db"
      ctx.fillRect(x, mid - h, Math.max(barW - 0.5, 0.5), h * 2)
    }

    // ── 3. DNSMOS sample markers ───────────────────────────────────────────
    if (quality?.samples && quality.samples.length > 0) {
      const n = quality.samples.length
      quality.samples.forEach((s, i) => {
        const pos = (i + 0.5) / n  // posición real del sample
        const x = pos * W
        ctx.strokeStyle = mosColor(s.ovrl, 0.7)
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, H - 14)
        ctx.stroke()
        ctx.setLineDash([])

        // label — solo mostrar si hay espacio (más de 40px entre markers)
        if (W / n > 40) {
          ctx.fillStyle = mosColor(s.ovrl, 1)
          ctx.font = "bold 9px monospace"
          ctx.textAlign = "center"
          ctx.fillText(s.ovrl.toFixed(2), x, H - 3)
        }
      })
    }

    // ── 4. speaker timeline strip (bottom 8px) ─────────────────────────────
    if (speakers?.turns && duration > 0) {
      const stripY = H - 24
      const stripH = 8

      // grey base
      ctx.fillStyle = "#f3f4f6"
      ctx.fillRect(0, stripY, W, stripH)

      speakers.turns.forEach((turn) => {
        const x = (turn.start_seconds / duration) * W
        const w = (turn.duration_seconds / duration) * W
        const spkIdx = speakers.speakers.findIndex(s => s.label === turn.speaker)
        ctx.fillStyle = SPEAKER_COLORS[spkIdx % SPEAKER_COLORS.length]
        ctx.fillRect(x, stripY, Math.max(w, 1), stripH)
      })
    }

    // ── 5. silencios ──────────────────────────────────────────────────────
    if (silences?.silences && duration > 0) {
      silences.silences.forEach((s) => {
        const x = (s.start_s / duration) * W
        const w = Math.max((s.duration_s / duration) * W, 2)
        // franja semitransparente gris oscuro
        ctx.fillStyle = "rgba(100,100,100,0.15)"
        ctx.fillRect(x, 0, w, H)
        // borde superior
        ctx.fillStyle = "rgba(100,100,100,0.5)"
        ctx.fillRect(x, 0, w, 2)
        // etiqueta si hay espacio
        if (w > 24) {
          ctx.fillStyle = "rgba(80,80,80,0.8)"
          ctx.font = "bold 8px monospace"
          ctx.textAlign = "center"
          ctx.fillText(`${s.duration_s.toFixed(0)}s`, x + w / 2, 10)
        }
      })
    }

    // ── 7. playhead ────────────────────────────────────────────────────────
    if (duration > 0) {
      const px = (currentT / duration) * W
      ctx.strokeStyle = "#1e40af"
      ctx.lineWidth = 2
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(px, 0)
      ctx.lineTo(px, H)
      ctx.stroke()

      // triangle handle
      ctx.fillStyle = "#1e40af"
      ctx.beginPath()
      ctx.moveTo(px - 5, 0)
      ctx.lineTo(px + 5, 0)
      ctx.lineTo(px, 8)
      ctx.closePath()
      ctx.fill()
    }
  }, [waveData, currentT, duration, quality, speakers, silences])

  useEffect(() => { drawCanvas() }, [drawCanvas])

  // ── resize observer ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = waveCanvas.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.offsetWidth * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio
      const ctx = canvas.getContext("2d")!
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
      drawCanvas()
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [drawCanvas])

  // ── playback RAF ───────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const tick = () => {
      setCurrentT(audio.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }

    const onPlay  = () => { setPlaying(true);  rafRef.current = requestAnimationFrame(tick) }
    const onPause = () => { setPlaying(false); cancelAnimationFrame(rafRef.current) }
    const onEnded = () => { setPlaying(false); cancelAnimationFrame(rafRef.current) }

    audio.addEventListener("play",  onPlay)
    audio.addEventListener("pause", onPause)
    audio.addEventListener("ended", onEnded)
    return () => {
      audio.removeEventListener("play",  onPlay)
      audio.removeEventListener("pause", onPause)
      audio.removeEventListener("ended", onEnded)
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // ── scrub on canvas click ──────────────────────────────────────────────────
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const t = ratio * duration
    if (audioRef.current) audioRef.current.currentTime = t
    setCurrentT(t)
  }

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    playing ? audio.pause() : audio.play()
  }

  const toggleMute = () => {
    const audio = audioRef.current
    if (!audio) return
    audio.muted = !audio.muted
    setMuted(!muted)
  }

  // ── speaker color legend ───────────────────────────────────────────────────
  const speakerLegend = speakers?.speakers ?? []

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-zinc-900">Player</h2>
          <p className="text-xs text-zinc-400 mt-0.5">Waveform · DNSMOS heatmap · Speakers</p>
        </div>
        {loadingWave && (
          <span className="text-xs text-zinc-400 flex items-center gap-1.5">
            <span className="w-3 h-3 border border-zinc-300 border-t-zinc-500 rounded-full animate-spin" />
            Decodificando audio...
          </span>
        )}
      </div>

      {/* Canvas */}
      <div className="px-5">
        <canvas
          ref={waveCanvas}
          className="w-full h-28 cursor-crosshair rounded-xl bg-zinc-50"
          style={{ display: "block" }}
          onClick={handleCanvasClick}
        />
      </div>

      {/* Controls */}
      <div className="px-5 py-4 flex items-center gap-4">
        <button
          onClick={togglePlay}
          className="w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-700 flex items-center justify-center transition-colors shrink-0"
        >
          {playing
            ? <Pause className="w-4 h-4 text-white" />
            : <Play  className="w-4 h-4 text-white ml-0.5" />}
        </button>

        {/* Time */}
        <span className="text-xs font-mono text-zinc-500 w-24 shrink-0">
          {fmtTime(currentT)} / {fmtTime(duration)}
        </span>

        {/* Progress bar (clickable) */}
        <div
          className="flex-1 h-1.5 bg-zinc-100 rounded-full cursor-pointer relative"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const t = ((e.clientX - rect.left) / rect.width) * duration
            if (audioRef.current) audioRef.current.currentTime = t
            setCurrentT(t)
          }}
        >
          <div
            className="h-full bg-blue-500 rounded-full transition-none"
            style={{ width: `${duration > 0 ? (currentT / duration) * 100 : 0}%` }}
          />
        </div>

        <button onClick={toggleMute} className="p-1.5 rounded-lg hover:bg-zinc-100 transition-colors">
          {muted
            ? <VolumeX className="w-4 h-4 text-zinc-400" />
            : <Volume2 className="w-4 h-4 text-zinc-400" />}
        </button>
      </div>

      {/* Legend */}
      <div className="px-5 pb-5 flex flex-wrap gap-x-5 gap-y-2">
        {/* DNSMOS legend */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-400 uppercase tracking-wide">DNSMOS</span>
          {[
            { label: "Excelente ≥4.0", color: mosColor(4.5, 1) },
            { label: "Buena ≥3.5",     color: mosColor(3.7, 1) },
            { label: "Aceptable ≥3.0", color: mosColor(3.2, 1) },
            { label: "Mejorar <3.0",   color: mosColor(2.0, 1) },
          ].map((l) => (
            <span key={l.label} className="flex items-center gap-1 text-xs text-zinc-500">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>

        {/* Speakers legend */}
        {speakerLegend.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400 uppercase tracking-wide">Hablantes</span>
            {speakerLegend.map((spk, i) => (
              <span key={spk.label} className="flex items-center gap-1 text-xs text-zinc-500">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: SPEAKER_COLORS[i % SPEAKER_COLORS.length] }}
                />
                {spk.label}{spk.is_main ? " (prof)" : ""}
              </span>
            ))}
          </div>
        )}

        {/* Silencios legend */}
        {silences && silences.num_silences > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400 uppercase tracking-wide">Silencios</span>
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-zinc-400 shrink-0 opacity-50" />
              {silences.num_silences} silencio{silences.num_silences > 1 ? "s" : ""} ≥{silences.min_duration_s}s · {silences.silence_percentage}% del audio
            </span>
          </div>
        )}
      </div>

      {/* hidden audio element */}
      <audio ref={audioRef} preload="metadata" className="hidden" />
    </div>
  )
}
