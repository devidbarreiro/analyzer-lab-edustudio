"use client"

import { useState, useEffect, useCallback } from "react"
import { Activity, History, Plus, X } from "lucide-react"
import { uploadFile, pollJob, listJobs, deleteJob, formatBytes } from "@/lib/api"
import type { Job, Step } from "@/lib/types"
import MultiUploadQueue from "./MultiUploadQueue"
import JobsHistory from "./JobsHistory"
import ResultsPanel from "./ResultsPanel"

type View = "upload" | "history" | "result"

export default function AnalyzerApp() {
  const [view, setView] = useState<View>("upload")
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Carga el historial
  const refreshHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const data = await listJobs()
      setJobs(data)
    } catch {
      // silencioso — no bloquear la UI
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => {
    refreshHistory()
  }, [refreshHistory])

  const handleViewResult = (job: Job) => {
    setSelectedJob(job)
    setView("result")
  }

  const handleDeleteJob = async (jobId: string) => {
    await deleteJob(jobId)
    setJobs((prev) => prev.filter((j) => j.id !== jobId))
    if (selectedJob?.id === jobId) {
      setSelectedJob(null)
      setView("upload")
    }
  }

  // Cuando un job termina (desde el queue), actualizar historial
  const handleJobDone = useCallback((job: Job) => {
    setJobs((prev) => {
      const idx = prev.findIndex((j) => j.id === job.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = job
        return next
      }
      return [job, ...prev]
    })
  }, [])

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Top bar */}
      <header className="bg-white border-b border-zinc-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="p-1.5 bg-blue-600 rounded-lg">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-zinc-900 text-sm leading-none">Analyzer Lab</h1>
              <p className="text-xs text-zinc-400 mt-0.5">Edustudio · Audio & Video Analysis</p>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex gap-1">
            <button
              onClick={() => setView("upload")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                view === "upload"
                  ? "bg-blue-50 text-blue-700"
                  : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100"
              }`}
            >
              <Plus className="w-4 h-4" />
              Subir vídeos
            </button>
            <button
              onClick={() => { setView("history"); refreshHistory() }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                view === "history" || view === "result"
                  ? "bg-blue-50 text-blue-700"
                  : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100"
              }`}
            >
              <History className="w-4 h-4" />
              Historial
              {jobs.length > 0 && (
                <span className="text-xs bg-zinc-200 text-zinc-600 rounded-full px-1.5 py-0.5 leading-none">
                  {jobs.length}
                </span>
              )}
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {view === "upload" && (
          <MultiUploadQueue
            onJobDone={handleJobDone}
            onViewResult={(job) => handleViewResult(job)}
          />
        )}

        {view === "history" && (
          <JobsHistory
            jobs={jobs}
            loading={loadingHistory}
            onRefresh={refreshHistory}
            onViewResult={handleViewResult}
            onDelete={handleDeleteJob}
          />
        )}

        {view === "result" && selectedJob && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setView("history")}
                className="text-sm text-zinc-500 hover:text-zinc-800 transition-colors"
              >
                ← Volver al historial
              </button>
              <span className="text-zinc-300">|</span>
              <span className="text-sm font-medium text-zinc-700 truncate">
                {selectedJob.label}
              </span>
            </div>
            {selectedJob.results ? (
              <ResultsPanel result={selectedJob.results} source={selectedJob.label} />
            ) : (
              <div className="text-center py-20 text-zinc-400">
                Este análisis no tiene resultados disponibles.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
