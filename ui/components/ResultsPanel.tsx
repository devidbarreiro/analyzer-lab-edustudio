"use client"

import type { AnalysisResult } from "@/lib/types"
import QualityCard from "./QualityCard"
import SpeakersCard from "./SpeakersCard"
import DenoiseCard from "./DenoiseCard"
import AudioPlayer from "./AudioPlayer"
import { Download } from "lucide-react"

interface Props {
  result: AnalysisResult
  source: File | string
}

export default function ResultsPanel({ result, source }: Props) {
  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `analysis-${result.file.replace(/[^a-z0-9]/gi, "-")}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const duration = result.quality?.duration_s ?? 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-zinc-900">Resultados</h2>
          <p className="text-sm text-zinc-400 truncate max-w-sm">{result.file}</p>
        </div>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 px-3 py-2 rounded-lg hover:bg-zinc-100 transition-colors"
        >
          <Download className="w-4 h-4" />
          JSON
        </button>
      </div>

      {/* Player — siempre visible si hay source */}
      {source && (
        <AudioPlayer
          source={source}
          duration={duration}
          quality={result.quality}
          speakers={result.speakers}
          denoise={result.denoise}
        />
      )}

      {/* Analysis cards */}
      {result.quality  && <QualityCard  data={result.quality}  />}
      {result.denoise  && <DenoiseCard  data={result.denoise}  />}
      {result.speakers && <SpeakersCard data={result.speakers} />}
    </div>
  )
}
