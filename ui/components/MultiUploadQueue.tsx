"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Upload, X, FileVideo, CheckCircle, AlertCircle, Loader2, Clock, Plus } from "lucide-react"
import { uploadFile, pollJob, formatBytes } from "@/lib/api"
import type { Job, Step } from "@/lib/types"

const STEP_LABELS: Record<string, string> = {
  quality: "Analizando calidad",
  denoise: "Reduciendo ruido",
  speakers: "Detectando hablantes",
}

const UPLOAD_CONCURRENCY = 2

const ALL_STEPS: { id: Step; label: string }[] = [
  { id: "quality",  label: "Calidad" },
  { id: "speakers", label: "Hablantes" },
  { id: "denoise",  label: "Denoise" },
]

interface QueueItem {
  id: string
  file: File
  jobId?: string
  status: "pending" | "uploading" | "queued" | "processing" | "done" | "error"
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
  const [items, setItems]   = useState<QueueItem[]>([])
  const [steps, setSteps]   = useState<Step[]>(["quality", "speakers", "denoise"])
  const [dragging, setDragging] = useState(false)
  const [started, setStarted]   = useState(false)

  const inputRef    = useRef<HTMLInputElement>(null)
  const runningRef  = useRef(new Set<string>())
  const stepsRef    = useRef(steps)
  useEffect(() => { stepsRef.current = steps }, [steps])

  const toggleStep = (s: Step) =>
    setSteps((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])

  // ── helpers ──────────────────────────────────────────────────────────────

  const updateItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, ...patch } : i))
  }, [])

  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((i) => i.id !== id))

  // ── scheduler ────────────────────────────────────────────────────────────

  // forward-declared so processItem can reference it
  const scheduleNextRef = useRef<(items: QueueItem[]) => void>(() => {})

  const processItem = useCallback(async (item: QueueItem) => {
    if (runningRef.current.has(item.id)) return
    runningRef.current.add(item.id)

    try {
      const jobId = await uploadFile({
        file: item.file,
        steps: stepsRef.current,
        label: item.file.name,
        onProgress: (phase, percent) =>
          updateItem(item.id, { status: "uploading", phase, percent }),
      })

      updateItem(item.id, { jobId, status: "queued", phase: "En cola...", percent: 0 })

      const job = await pollJob(jobId, (j) => {
        if (j.status === "queued") {
          updateItem(item.id, { status: "queued", phase: "En cola...", percent: 0, job: j })
        } else if (j.status === "processing") {
          const label = j.current_step ? STEP_LABELS[j.current_step] ?? j.current_step : "Procesando"
          updateItem(item.id, {
            status: "processing",
            phase: `${label}...`,
            percent: j.progress,
            currentStep: j.current_step,
            job: j,
          })
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
      setItems((prev) => { scheduleNextRef.current(prev); return prev })
    }
  }, [onJobDone, updateItem])

  const scheduleNext = useCallback((currentItems: QueueItem[]) => {
    const slots = UPLOAD_CONCURRENCY - runningRef.current.size
    if (slots <= 0) return
    currentItems
      .filter((i) => i.status === "pending")
      .slice(0, slots)
      .forEach((i) => processItem(i))
  }, [processItem])

  useEffect(() => { scheduleNextRef.current = scheduleNext }, [scheduleNext])

  // ── add files ─────────────────────────────────────────────────────────────

  const addFiles = useCallback((files: File[]) => {
    const newItems: QueueItem[] = files.map((f) => ({
      id: `${Date.now()}-${Math.random()}`,
      file: f,
      status: "pending",
      phase: "Pendiente",
      percent: 0,
    }))
    setItems((prev) => {
      const next = [...prev, ...newItems]
      // Si ya está en marcha, arrancar automáticamente los nuevos
      if (started) scheduleNext(next)
      return next
    })
  }, [started, scheduleNext])

  const handleStart = () => {
    if (steps.length === 0) return
    setStarted(true)
    setItems((prev) => { scheduleNext(prev); return prev })
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(isVideoOrAudio)
    if (files.length) addFiles(files)
  }, [addFiles])

  // ── derived state ─────────────────────────────────────────────────────────

  const pendingItems    = items.filter((i) => i.status === "pending")
  const activeItems     = items.filter((i) => ["uploading", "queued", "processing"].includes(i.status))
  const doneItems       = items.filter((i) => i.status === "done" || i.status === "error")
  const processingItems = items.filter((i) => i.status === "processing")
  const uploadingItems  = items.filter((i) => i.status === "uploading")

  const hasAny = items.length > 0
  const hasActive = activeItems.length > 0

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-3xl mx-auto">

      <div>
        <h2 className="text-2xl font-bold text-zinc-900">Subir vídeos</h2>
        <p className="text-zinc-500 mt-1">
          Selecciona varios vídeos — se procesan de {UPLOAD_CONCURRENCY} en {UPLOAD_CONCURRENCY} automáticamente.
        </p>
      </div>

      {/* Drop zone — siempre visible */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
          dragging ? "border-blue-500 bg-blue-50" : "border-zinc-200 hover:border-zinc-400 bg-zinc-50"
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
        {hasAny ? (
          <div className="flex items-center justify-center gap-2 text-zinc-500">
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">Añadir más vídeos</span>
          </div>
        ) : (
          <>
            <Upload className="w-10 h-10 text-zinc-400 mx-auto mb-3" />
            <p className="text-zinc-600 font-medium">Arrastra vídeos aquí o haz clic para seleccionar</p>
            <p className="text-sm text-zinc-400 mt-1">MP4, MOV, WebM, MKV, MP3, WAV</p>
          </>
        )}
      </div>

      {/* Análisis steps — solo cuando hay items y no ha arrancado */}
      {hasAny && !started && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-zinc-600">Análisis:</span>
          {ALL_STEPS.map((s) => {
            const active = steps.includes(s.id)
            return (
              <button key={s.id} type="button" onClick={() => toggleStep(s.id)}
                className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                  active ? "border-blue-500 bg-blue-50 text-blue-700" : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
                }`}
              >
                {s.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Cola */}
      {hasAny && (
        <div className="space-y-4">

          {/* Resumen de estado global */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm text-zinc-500 flex-wrap">
              {processingItems.length > 0 && (
                <span className="flex items-center gap-1.5 text-blue-600 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {processingItems.length} procesando
                </span>
              )}
              {uploadingItems.length > 0 && (
                <span className="flex items-center gap-1.5 text-blue-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {uploadingItems.length} subiendo
                </span>
              )}
              {pendingItems.length > 0 && started && (
                <span className="flex items-center gap-1.5 text-zinc-400">
                  <Clock className="w-3.5 h-3.5" />
                  {pendingItems.length} en espera
                </span>
              )}
              {!hasActive && doneItems.length > 0 && (
                <span className="text-green-600 font-medium">
                  {doneItems.filter(i => i.status === "done").length} completados
                  {doneItems.filter(i => i.status === "error").length > 0 &&
                    ` · ${doneItems.filter(i => i.status === "error").length} con error`}
                </span>
              )}
            </div>

            {!started && pendingItems.length > 0 && (
              <button
                onClick={handleStart}
                disabled={steps.length === 0}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                Analizar {pendingItems.length} vídeo{pendingItems.length !== 1 ? "s" : ""}
              </button>
            )}
          </div>

          {/* Activos primero, luego pendientes, luego finalizados */}
          {[...activeItems, ...pendingItems, ...doneItems].map((item, idx) => {
            // posición en cola (solo para pending tras arrancar)
            const queuePos = started && item.status === "pending"
              ? pendingItems.indexOf(item) + 1
              : null
            return (
              <QueueRow
                key={item.id}
                item={item}
                queuePos={queuePos}
                onRemove={() => removeItem(item.id)}
                onViewResult={item.job ? () => onViewResult(item.job!) : undefined}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── QueueRow ──────────────────────────────────────────────────────────────────

function QueueRow({
  item,
  queuePos,
  onRemove,
  onViewResult,
}: {
  item: QueueItem
  queuePos: number | null
  onRemove: () => void
  onViewResult?: () => void
}) {
  const { file, status, phase, percent, error, job } = item

  const isActive   = status === "uploading" || status === "processing"
  const isQueued   = status === "queued"
  const isPending  = status === "pending"
  const isDone     = status === "done"
  const isError    = status === "error"

  const statusIcon = isActive  ? <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
    : isQueued                 ? <Clock className="w-4 h-4 text-amber-500" />
    : isPending                ? <div className="w-4 h-4 rounded-full border-2 border-zinc-300" />
    : isDone                   ? <CheckCircle className="w-4 h-4 text-green-500" />
    : isError                  ? <AlertCircle className="w-4 h-4 text-red-500" />
    :                            null

  const barColor = isActive  ? "bg-blue-500"
    : isQueued               ? "bg-amber-400"
    : isDone                 ? "bg-green-500"
    : isError                ? "bg-red-400"
    :                          "bg-zinc-200"

  // Progreso real: durante processing el backend emite 0-100
  const displayPercent = status === "uploading"
    ? Math.min(100, Math.round(((percent - 2) / 90) * 100))
    : status === "processing" && job
    ? job.progress
    : status === "done" ? 100
    : status === "queued" ? 0
    : 0

  const phaseText = isError   ? (error ?? "Error desconocido").split("\n")[0]
    : isQueued                ? "Esperando slot de procesamiento..."
    : isPending               ? (queuePos ? `Posición ${queuePos} en cola` : "Listo para analizar")
    : phase

  const rowBg = isPending ? "bg-white border-zinc-100 opacity-60"
    : isError              ? "bg-red-50 border-red-200"
    : isDone               ? "bg-green-50 border-green-200"
    : isQueued             ? "bg-amber-50 border-amber-200"
    :                        "bg-white border-zinc-200"

  return (
    <div className={`border rounded-xl p-4 flex items-center gap-4 transition-all ${rowBg}`}>
      <div className="shrink-0">{statusIcon}</div>

      <FileVideo className="w-5 h-5 text-zinc-400 shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-sm font-medium text-zinc-800 truncate">{file.name}</p>
          <p className="text-xs text-zinc-400 shrink-0">{formatBytes(file.size)}</p>
        </div>

        {/* Barra */}
        {!isPending && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${isQueued ? 100 : displayPercent}%`, opacity: isQueued ? 0.35 : 1 }}
                />
              </div>
              {isActive && (
                <span className="text-xs tabular-nums text-zinc-400 shrink-0 w-8 text-right">
                  {displayPercent}%
                </span>
              )}
            </div>
            <p className={`text-xs truncate ${
              isError ? "text-red-500" : isQueued ? "text-amber-600" : isDone ? "text-green-600" : "text-zinc-500"
            }`}>
              {phaseText}
            </p>
          </div>
        )}

        {/* Pending: solo texto */}
        {isPending && (
          <p className="text-xs text-zinc-400">{phaseText}</p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isDone && onViewResult && (
          <button onClick={onViewResult} className="text-xs text-blue-600 hover:underline font-medium">
            Ver resultados
          </button>
        )}
        {(isPending || isError || isDone) && (
          <button onClick={onRemove}
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
