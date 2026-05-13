"use client"

import { useEffect, useRef, useState } from "react"
import { Play, Pause, Loader2 } from "lucide-react"

interface Props {
  source: File | string
  offsetS?: number
  durationS?: number
}

type AudioPair = { original: string; denoised: string }
type Mode = "original" | "denoised"

export default function DenoisePreviewPlayer({ source, offsetS, durationS = 30 }: Props) {
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [pair, setPair]         = useState<AudioPair | null>(null)
  const [mode, setMode]         = useState<Mode>("original")
  const [playing, setPlaying]   = useState(false)
  const [progress, setProgress] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const rafRef   = useRef<number>(0)

  // Carga el preview desde la API
  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const form = new FormData()
      if (source instanceof File) {
        form.append("file", source)
      } else {
        form.append("url", source)
      }
      if (offsetS !== undefined) form.append("offset_s", String(offsetS))
      form.append("duration_s", String(durationS))

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/denoise-preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_API_KEY}` },
        body: form,
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()

      const toUrl = (b64: string) => {
        const bin = atob(b64)
        const arr = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        const blob = new Blob([arr], { type: "audio/wav" })
        return URL.createObjectURL(blob)
      }

      setPair({ original: toUrl(data.original_wav_b64), denoised: toUrl(data.denoised_wav_b64) })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando preview")
    } finally {
      setLoading(false)
    }
  }

  // Cambiar src cuando cambia modo
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !pair) return
    const wasPlaying = !audio.paused
    audio.src = mode === "original" ? pair.original : pair.denoised
    audio.load()
    if (wasPlaying) audio.play()
  }, [mode, pair])

  // RAF para progress
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const tick = () => {
      if (audio.duration) setProgress(audio.currentTime / audio.duration)
      rafRef.current = requestAnimationFrame(tick)
    }
    const onPlay  = () => { setPlaying(true);  rafRef.current = requestAnimationFrame(tick) }
    const onPause = () => { setPlaying(false); cancelAnimationFrame(rafRef.current) }
    const onEnded = () => { setPlaying(false); setProgress(0); cancelAnimationFrame(rafRef.current) }
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

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    playing ? audio.pause() : audio.play()
  }

  if (!pair && !loading && !error) {
    return (
      <button
        onClick={load}
        className="w-full py-2.5 rounded-xl border border-dashed border-zinc-300 text-sm text-zinc-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
      >
        Escuchar fragmento antes / después
      </button>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400 py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Procesando audio...
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>
  }

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex gap-1 p-1 bg-zinc-100 rounded-xl w-fit">
        {(["original", "denoised"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              mode === m ? "bg-white shadow text-zinc-900" : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {m === "original" ? "Original" : "Sin ruido"}
          </button>
        ))}
      </div>

      {/* Player */}
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-700 flex items-center justify-center shrink-0 transition-colors"
        >
          {playing
            ? <Pause className="w-3.5 h-3.5 text-white" />
            : <Play  className="w-3.5 h-3.5 text-white ml-0.5" />}
        </button>

        <div
          className="flex-1 h-1.5 bg-zinc-100 rounded-full cursor-pointer"
          onClick={(e) => {
            const audio = audioRef.current
            if (!audio) return
            const rect = e.currentTarget.getBoundingClientRect()
            audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration
          }}
        >
          <div
            className={`h-full rounded-full transition-none ${mode === "original" ? "bg-zinc-400" : "bg-emerald-500"}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <span className="text-xs text-zinc-400 shrink-0">{durationS}s</span>
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  )
}
