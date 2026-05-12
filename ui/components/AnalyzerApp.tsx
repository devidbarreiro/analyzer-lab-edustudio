"use client"

import { useState } from "react"
import { analyzeVideo, ApiError } from "@/lib/api"
import type { AnalysisResult, Step } from "@/lib/types"
import UploadForm from "./UploadForm"
import ResultsPanel from "./ResultsPanel"
import { AlertCircle, RotateCcw, Activity } from "lucide-react"

type State =
  | { status: "idle" }
  | { status: "loading"; message: string }
  | { status: "done"; result: AnalysisResult; source: File | string }
  | { status: "error"; message: string }

export default function AnalyzerApp() {
  const [state, setState] = useState<State>({ status: "idle" })

  const handleSubmit = async ({
    file,
    url,
    steps,
  }: {
    file?: File
    url?: string
    steps: Step[]
  }) => {
    setState({ status: "loading", message: "Iniciando análisis..." })
    try {
      const result = await analyzeVideo({
        file,
        url,
        steps,
        onProgress: (msg) => setState({ status: "loading", message: msg }),
      })
      setState({ status: "done", result, source: file ?? url ?? "" })
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Error ${err.status}: ${err.message}`
          : err instanceof Error
          ? err.message
          : "Error desconocido"
      setState({ status: "error", message: msg })
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Top bar */}
      <header className="bg-white border-b border-zinc-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="p-1.5 bg-blue-600 rounded-lg">
            <Activity className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-zinc-900 text-sm leading-none">Analyzer Lab</h1>
            <p className="text-xs text-zinc-400 mt-0.5">Edustudio · Audio & Video Analysis</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {state.status === "idle" || state.status === "loading" || state.status === "error" ? (
          <div className="max-w-xl mx-auto space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-zinc-900">Analiza tu vídeo</h2>
              <p className="text-zinc-500 mt-1">
                Sube un vídeo o pega una URL para obtener métricas de calidad de audio,
                diarización de hablantes y análisis de reducción de ruido.
              </p>
            </div>

            <div className="bg-white border border-zinc-200 rounded-2xl p-6">
              <UploadForm
                onSubmit={handleSubmit}
                loading={state.status === "loading"}
              />
            </div>

            {/* Loading state */}
            {state.status === "loading" && (
              <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0" />
                <p className="text-sm text-blue-700">{state.message}</p>
              </div>
            )}

            {/* Error state */}
            {state.status === "error" && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-700">Error al analizar</p>
                  <p className="text-sm text-red-600 mt-0.5">{state.message}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <button
              onClick={() => setState({ status: "idle" })}
              className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-800 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Nuevo análisis
            </button>
            <ResultsPanel result={state.result} source={state.source} />
          </div>
        )}
      </main>
    </div>
  )
}
