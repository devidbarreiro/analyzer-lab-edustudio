"use client"

import type { DenoiseResult } from "@/lib/types"

function ScoreRow({ label, before, after, delta }: { label: string; before: number; after: number; delta: number }) {
  const improved = delta > 0
  return (
    <div className="flex items-center gap-4 py-3 border-b border-zinc-50 last:border-0">
      <span className="text-sm text-zinc-500 w-20 shrink-0">{label}</span>
      <div className="flex-1 flex items-center gap-3">
        <span className="text-sm font-mono text-zinc-500 w-12 text-right">{before.toFixed(3)}</span>
        <div className="flex-1 relative h-2 bg-zinc-100 rounded-full overflow-hidden">
          <div className="absolute h-full bg-zinc-300 rounded-full" style={{ width: `${Math.min(100, ((before - 1) / 4) * 100)}%` }} />
          <div className={`absolute h-full rounded-full transition-all duration-700 ${improved ? "bg-emerald-400" : "bg-red-400"}`}
            style={{ width: `${Math.min(100, ((after - 1) / 4) * 100)}%`, opacity: 0.6 }} />
        </div>
        <span className="text-sm font-mono text-zinc-800 w-12">{after.toFixed(3)}</span>
        <span className={`text-xs font-semibold w-16 text-right ${improved ? "text-emerald-600" : delta < 0 ? "text-red-500" : "text-zinc-400"}`}>
          {delta > 0 ? "+" : ""}{delta.toFixed(3)}
        </span>
      </div>
    </div>
  )
}

export default function DenoiseCard({ data }: { data: DenoiseResult }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold text-zinc-900">Reducción de ruido</h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            Fragmento analizado: {data.analysis_offset_s}s — {(data.analysis_offset_s + data.analysis_duration_s).toFixed(0)}s
          </p>
        </div>
        <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${
          data.worth_denoising
            ? "text-emerald-600 bg-emerald-50 border-emerald-200"
            : "text-zinc-500 bg-zinc-50 border-zinc-200"
        }`}>
          {data.worth_denoising ? "Recomendado" : "No necesario"}
        </span>
      </div>

      {/* Mejora global */}
      <div className={`rounded-xl p-4 ${data.worth_denoising ? "bg-emerald-50" : "bg-zinc-50"}`}>
        <p className="text-xs text-zinc-400 uppercase tracking-wide">Mejora OVRL MOS</p>
        <p className={`text-3xl font-bold mt-1 ${data.improvement > 0 ? "text-emerald-600" : "text-zinc-500"}`}>
          {data.improvement > 0 ? "+" : ""}{data.improvement.toFixed(3)}
        </p>
        <p className="text-sm text-zinc-500 mt-1">
          {data.before.ovrl_mos.toFixed(3)} → {data.after.ovrl_mos.toFixed(3)}
        </p>
      </div>

      {/* Tabla comparativa */}
      <div>
        <div className="flex items-center gap-4 mb-1 px-0">
          <span className="text-xs text-zinc-400 w-20 shrink-0">Score</span>
          <div className="flex-1 flex gap-3 text-xs text-zinc-400">
            <span className="w-12 text-right">Antes</span>
            <div className="flex-1" />
            <span className="w-12">Después</span>
            <span className="w-16 text-right">Delta</span>
          </div>
        </div>
        <ScoreRow label="OVRL" before={data.before.ovrl_mos} after={data.after.ovrl_mos} delta={data.delta.ovrl_mos} />
        <ScoreRow label="SIG" before={data.before.sig_mos} after={data.after.sig_mos} delta={data.delta.sig_mos} />
        <ScoreRow label="BAK" before={data.before.bak_mos} after={data.after.bak_mos} delta={data.delta.bak_mos} />
      </div>
    </div>
  )
}
