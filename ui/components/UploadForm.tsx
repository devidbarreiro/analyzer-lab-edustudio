"use client"

import { useRef, useState, useCallback } from "react"
import { Upload, Link, X, FileVideo } from "lucide-react"
import type { Step } from "@/lib/types"

const ALL_STEPS: { id: Step; label: string; description: string }[] = [
  { id: "quality", label: "Calidad de audio", description: "DNSMOS · SNR · Clipping" },
  { id: "speakers", label: "Diarización", description: "Hablantes · Turnos · Tiempos" },
  { id: "denoise", label: "Reducción de ruido", description: "Comparativa antes / después" },
]

interface Props {
  onSubmit: (args: { file?: File; url?: string; steps: Step[] }) => void
  loading: boolean
}

export default function UploadForm({ onSubmit, loading }: Props) {
  const [mode, setMode] = useState<"file" | "url">("file")
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState("")
  const [steps, setSteps] = useState<Step[]>(["quality", "speakers", "denoise"])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const toggleStep = (step: Step) =>
    setSteps((prev) =>
      prev.includes(step) ? prev.filter((s) => s !== step) : [...prev, step]
    )

  const handleFile = (f: File) => setFile(f)

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (steps.length === 0) return
    if (mode === "file" && file) onSubmit({ file, steps })
    else if (mode === "url" && url.trim()) onSubmit({ url: url.trim(), steps })
  }

  const canSubmit =
    !loading &&
    steps.length > 0 &&
    (mode === "file" ? !!file : url.trim().length > 0)

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Mode toggle */}
      <div className="flex gap-2 p-1 bg-zinc-100 rounded-xl w-fit">
        {(["file", "url"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              mode === m
                ? "bg-white shadow text-zinc-900"
                : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {m === "file" ? "Subir fichero" : "URL externa"}
          </button>
        ))}
      </div>

      {/* Input */}
      {mode === "file" ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${
            dragging
              ? "border-blue-500 bg-blue-50"
              : file
              ? "border-green-400 bg-green-50"
              : "border-zinc-300 hover:border-zinc-400 bg-zinc-50"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <FileVideo className="w-8 h-8 text-green-500 shrink-0" />
              <div className="text-left">
                <p className="font-medium text-zinc-800 truncate max-w-xs">{file.name}</p>
                <p className="text-sm text-zinc-500">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFile(null) }}
                className="ml-auto p-1 rounded-full hover:bg-green-100"
              >
                <X className="w-4 h-4 text-zinc-500" />
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Upload className="w-10 h-10 text-zinc-400 mx-auto" />
              <p className="text-zinc-600 font-medium">Arrastra un vídeo o haz clic para seleccionar</p>
              <p className="text-sm text-zinc-400">MP4, MOV, WebM, MKV, MP3, WAV · Máx 500 MB</p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://ejemplo.com/video.mp4"
              className="w-full pl-9 pr-4 py-3 border border-zinc-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          {url && (
            <button
              type="button"
              onClick={() => setUrl("")}
              className="p-3 rounded-xl border border-zinc-300 hover:bg-zinc-50"
            >
              <X className="w-4 h-4 text-zinc-400" />
            </button>
          )}
        </div>
      )}

      {/* Step selection */}
      <div>
        <p className="text-sm font-medium text-zinc-700 mb-3">Análisis a ejecutar</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {ALL_STEPS.map((s) => {
            const active = steps.includes(s.id)
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleStep(s.id)}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  active
                    ? "border-blue-500 bg-blue-50"
                    : "border-zinc-200 hover:border-zinc-300 bg-white"
                }`}
              >
                <p className={`font-medium text-sm ${active ? "text-blue-700" : "text-zinc-700"}`}>
                  {s.label}
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">{s.description}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Analizando..." : "Analizar vídeo"}
      </button>
    </form>
  )
}
