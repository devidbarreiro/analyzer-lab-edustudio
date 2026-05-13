"use client"

import { RefreshCw, Trash2, Eye, FileVideo, Clock, CheckCircle, AlertCircle, Loader2, Hourglass } from "lucide-react"
import type { Job, JobStatus } from "@/lib/types"
import { formatBytes } from "@/lib/api"

interface Props {
  jobs: Job[]
  loading: boolean
  onRefresh: () => void
  onViewResult: (job: Job) => void
  onDelete: (jobId: string) => void
}

export default function JobsHistory({ jobs, loading, onRefresh, onViewResult, onDelete }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900">Historial</h2>
          <p className="text-zinc-500 mt-1">{jobs.length} análisis registrados</p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 border border-zinc-200 rounded-xl hover:bg-zinc-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {jobs.length === 0 && !loading && (
        <div className="text-center py-20 text-zinc-400">
          <FileVideo className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Todavía no hay análisis. Sube tu primer vídeo.</p>
        </div>
      )}

      <div className="space-y-3">
        {jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            onViewResult={() => onViewResult(job)}
            onDelete={() => onDelete(job.id)}
          />
        ))}
      </div>
    </div>
  )
}

function JobRow({
  job,
  onViewResult,
  onDelete,
}: {
  job: Job
  onViewResult: () => void
  onDelete: () => void
}) {
  const statusConfig: Record<JobStatus, { icon: React.ReactNode; label: string; color: string }> = {
    pending:    { icon: <Hourglass className="w-4 h-4" />, label: "Pendiente", color: "text-zinc-400" },
    uploading:  { icon: <Loader2 className="w-4 h-4 animate-spin" />, label: "Subiendo", color: "text-blue-500" },
    queued:     { icon: <Clock className="w-4 h-4" />, label: "En cola", color: "text-amber-500" },
    processing: { icon: <Loader2 className="w-4 h-4 animate-spin" />, label: `Procesando ${job.progress}%`, color: "text-blue-500" },
    done:       { icon: <CheckCircle className="w-4 h-4" />, label: "Completado", color: "text-green-500" },
    error:      { icon: <AlertCircle className="w-4 h-4" />, label: "Error", color: "text-red-500" },
  }

  const { icon, label, color } = statusConfig[job.status]

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4 flex items-center gap-4 hover:border-zinc-300 transition-colors">
      <FileVideo className="w-5 h-5 text-zinc-400 shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-800 truncate">{job.label}</p>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-zinc-400">
          {job.file_size && <span>{formatBytes(job.file_size)}</span>}
          <span>{job.steps.join(", ")}</span>
          <span>{formatDate(job.created_at)}</span>
        </div>
        {job.status === "error" && job.error_msg && (
          <p className="text-xs text-red-500 mt-1 truncate">{job.error_msg.split("\n")[0]}</p>
        )}
        {job.status === "processing" && (
          <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Status badge */}
      <div className={`flex items-center gap-1.5 text-xs font-medium shrink-0 ${color}`}>
        {icon}
        {label}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {job.status === "done" && job.results && (
          <button
            onClick={onViewResult}
            className="p-2 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
            title="Ver resultados"
          >
            <Eye className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onDelete}
          className="p-2 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 transition-colors"
          title="Eliminar"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("es-ES", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}
