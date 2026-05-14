"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Upload, X, FileVideo, CheckCircle, AlertCircle, Loader2, Play, Clock } from "lucide-react"
import { uploadFile, pollJob, formatBytes } from "@/lib/api"
import type { Job, Step } from "@/lib/types"

const STEP_LABELS: Record<string, string> = {
  quality: "Analizando calidad",
  denoise: "Reduciendo ruido",
  speakers: "Detectando hablantes",
}

const UPLOAD_CONCURRENCY = 2   // máx uploads simultáneos

const ALL_STEPS: { id: Step; label: string }[] = [
  { id: "quality", label: "Calidad" },
  { id: "speakers", label: "Hablantes" },
  { id: "denoise", label: "Denoise" },
]

interface QueueItem {
  id: string           // local id (antes de tener job_id)
  file: File
  jobId?: string
  status: "waiting" | "uploading" | "queued" | "processing" | "done" | "error"
  phase: string
  percent: number
  currentStep?: string | null
  error?: string
  job?: Job
}

interface Props {
  onJobDone: (job: Job) => void
  onViewResult: (job: Job) => void
}

export default function MultiUploadQueue({ onJobDone, onViewResult }: Props) {
  const [items, setItems] = useState<QueueItem[]>([])
  const [steps, setSteps] = useState<Step[]>(["quality", "speakers", "denoise"])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const runningRef = useRef(new Set<string>())    // ids activos ahora mismo
  const stepsRef = useRef(steps)                  // ref para acceder en el scheduler
  useEffect(() => { stepsRef.current = steps }, [steps])

  const toggleStep = (s: Step) =>
    setSteps((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])

  const addFiles = useCallback((files: File[]) => {
    const newItems: QueueItem[] = files.map((f) => ({
      id: `${Date.now()}-${Math.random()}`,
      file: f,
      status: "waiting",
      phase: "En espera",
      percent: 0,
    }))
    setItems((prev) => [...prev, ...newItems])
  }, [])

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const updateItem = (id: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, ...patch } : i))
  }

  // Scheduler: arranca el siguiente waiting si hay hueco (máx UPLOAD_CONCURRENCY)
  const scheduleNext = useCallback((currentItems: QueueItem[]) => {
    const running = runningRef.current.size
    const slots = UPLOAD_CONCURRENCY - running
    if (slots <= 0) return

    const waiting = currentItems.filter((i) => i.status === "waiting")
    waiting.slice(0, slots).forEach((item) => processItem(item, stepsRef.current))
  }, [])  // processItem se añade abajo — se define primero para evitar dep circular

  const processItem = useCallback(async (item: QueueItem, currentSteps: Step[]) => {
    if (runningRef.current.has(item.id)) return
    runningRef.current.add(item.id)

    try {
      const jobId = await uploadFile({
        file: item.file,
        steps: currentSteps,
        label: item.file.name,
        onProgress: (phase, percent) => {
          updateItem(item.id, { status: "uploading", phase, percent })
        },
      })

      updateItem(item.id, { jobId, status: "queued", phase: "En cola...", percent: 95 })

      const job = await pollJob(jobId, (j) => {
        if (j.status === "queued") {
          updateItem(item.id, { status: "queued", phase: "En cola...", percent: 95, job: j })
        } else if (j.status === "processing") {
          const stepLabel = j.current_step ? STEP_LABELS[j.current_step] ?? j.current_step : "Procesando"
          const phase = `${stepLabel}...`
          // Mapeo: upload ocupa 0-95, procesamiento 95-100 → usamos progreso real del backend
          const percent = 95 + Math.round(j.progress * 0.05)
          updateItem(item.id, { status: "processing", phase, percent, currentStep: j.current_step, job: j })
        } else {
          updateItem(item.id, { job: j })
        }
      })

      if (job.status === "error") {
        updateItem(item.id, { status: "error", phase: "Error", error: job.error_msg ?? "Error desconocido", job })
      } else {
        updateItem(item.id, { status: "done", phase: "Listo", percent: 100, job })
        onJobDone(job)
      }
    } catch (err) {
      updateItem(item.id, {
        status: "error",
        phase: "Error",
        error: err instanceof Error ? err.message : "Error desconocido",
      })
    } finally {
      runningRef.current.delete(item.id)
      // Cuando termina uno, arrancar el siguiente waiting si hay
      setItems((prev) => {
        scheduleNext(prev)
        return prev
      })
    }
  }, [onJobDone, scheduleNext])

  const handleStartAll = () => {
    if (steps.length === 0) return
    // Arranca los primeros UPLOAD_CONCURRENCY, el resto se encolan automáticamente
    setItems((prev) => {
      scheduleNext(prev)
      return prev
    })
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(isVideoOrAudio)
    if (files.length) addFiles(files)
  }, [addFiles])

  const waitingCount = items.filter((i) => i.status === "waiting").length
  const activeCount = items.filter((i) => ["uploading", "queued", "processing"].includes(i.status)).length

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-zinc-900">Subir vídeos</h2>
        <p className="text-zinc-500 mt-1">Añade hasta varios vídeos a la vez. Cada uno se procesa en paralelo.</p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-blue-500 bg-blue-50"
            : "border-zinc-300 hover:border-zinc-400 bg-white"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*,audio/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []).filter(isVideoOrAudio)
            if (files.length) addFiles(files)
            e.target.value = ""
          }}
        />
        <Upload className="w-10 h-10 text-zinc-400 mx-auto mb-3" />
        <p className="text-zinc-600 font-medium">Arrastra vídeos aquí o haz clic para seleccionar</p>
        <p className="text-sm text-zinc-400 mt-1">MP4, MOV, WebM, MKV, MP3, WAV · Sin límite de tamaño</p>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-zinc-600">Análisis:</span>
        {ALL_STEPS.map((s) => {
          const active = steps.includes(s.id)
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => toggleStep(s.id)}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                active
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
              }`}
            >
              {s.label}
            </button>
          )
        })}
      </div>

      {/* Queue */}
      {items.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-700">
              {items.length} fichero{items.length !== 1 ? "s" : ""}
              {activeCount > 0 && ` · ${activeCount} procesando`}
            </p>
            {waitingCount > 0 && (
              <button
                onClick={handleStartAll}
                disabled={steps.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                Analizar {waitingCount} vídeo{waitingCount !== 1 ? "s" : ""}
              </button>
            )}
          </div>

          <div className="space-y-2">
            {items.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                onRemove={() => removeItem(item.id)}
                onViewResult={item.job ? () => onViewResult(item.job!) : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function QueueRow({
  item,
  onRemove,
  onViewResult,
}: {
  item: QueueItem
  onRemove: () => void
  onViewResult?: () => void
}) {
  const { file, status, phase, percent, error, job } = item

  const statusIcon = {
    waiting:    <div className="w-4 h-4 rounded-full border-2 border-zinc-300" />,
    uploading:  <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
    queued:     <Clock className="w-4 h-4 text-amber-500" />,
    processing: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
    done:       <CheckCircle className="w-4 h-4 text-green-500" />,
    error:      <AlertCircle className="w-4 h-4 text-red-500" />,
  }[status]

  const barColor = {
    waiting:    "bg-zinc-300",
    uploading:  "bg-blue-500",
    queued:     "bg-amber-400",
    processing: "bg-blue-500",
    done:       "bg-green-500",
    error:      "bg-red-400",
  }[status]

  // Para processing mostramos el progreso real del backend (0-100), no el comprimido
  const displayPercent = status === "processing" && job
    ? job.progress
    : status === "uploading"
    // Durante upload el percent va de 2 a 92, lo remapeamos a 0-100
    ? Math.min(100, Math.round(((percent - 2) / 90) * 100))
    : percent

  const phaseText = error
    ? error.split("\n")[0]
    : status === "queued"
    ? "En cola — esperando slot de procesamiento"
    : phase

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4 flex items-center gap-4">
      {statusIcon}

      <FileVideo className="w-5 h-5 text-zinc-400 shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-zinc-800 truncate">{file.name}</p>
          <p className="text-xs text-zinc-400 shrink-0">{formatBytes(file.size)}</p>
        </div>

        {/* Barra de progreso */}
        {status !== "waiting" && (
          <div className="mt-1.5 space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${displayPercent}%` }}
                />
              </div>
              {status !== "done" && status !== "error" && (
                <span className="text-xs tabular-nums text-zinc-400 shrink-0 w-8 text-right">
                  {displayPercent}%
                </span>
              )}
            </div>
            <p className={`text-xs truncate ${error ? "text-red-500" : status === "queued" ? "text-amber-600" : "text-zinc-500"}`}>
              {phaseText}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {status === "done" && onViewResult && (
          <button
            onClick={onViewResult}
            className="text-xs text-blue-600 hover:underline font-medium"
          >
            Ver resultados
          </button>
        )}
        {(status === "waiting" || status === "error" || status === "done") && (
          <button
            onClick={onRemove}
            className="p-1 rounded-full hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}

function isVideoOrAudio(file: File): boolean {
  return file.type.startsWith("video/") || file.type.startsWith("audio/")
}
