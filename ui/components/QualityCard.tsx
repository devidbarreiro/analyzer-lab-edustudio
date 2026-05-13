"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from "recharts"
import type { QualityResult } from "@/lib/types"
import Tooltip from "./Tooltip"

const TOOLTIPS = {
  ovrl: "OVRL MOS: calidad global perceptual del audio. Combina la calidad de la voz y del ruido de fondo. Escala 1–5.",
  sig:  "SIG MOS: calidad de la señal de voz — claridad y naturalidad. Escala 1–5.",
  bak:  "BAK MOS: calidad del fondo — ausencia de ruido ambiental, eco o reverb. Escala 1–5.",
  snr:  "SNR (Signal-to-Noise Ratio): relación señal/ruido estimada en dB. Por encima de 20 dB es aceptable, por encima de 30 dB es buena.",
  peak: "Nivel pico máximo del audio en dB. Si está por encima de −1 dB hay riesgo de clipping (distorsión por saturación de la señal).",
  grade: "Calificación basada en OVRL MOS: Excelente ≥4.0 · Buena ≥3.5 · Aceptable ≥3.0 · Mejorar <3.0",
  samples: "Cada barra representa una muestra de 30 segundos en una posición del vídeo. El OVRL MOS varía a lo largo del tiempo — zonas rojas indican peor calidad.",
}

const GRADE_COLOR: Record<string, string> = {
  Excelente: "text-emerald-600 bg-emerald-50 border-emerald-200",
  Buena:     "text-blue-600 bg-blue-50 border-blue-200",
  Aceptable: "text-amber-600 bg-amber-50 border-amber-200",
  Mejorar:   "text-red-600 bg-red-50 border-red-200",
}

const MOS_COLOR = (v: number) => {
  if (v >= 4.0) return "#10b981"
  if (v >= 3.5) return "#3b82f6"
  if (v >= 3.0) return "#f59e0b"
  return "#ef4444"
}

function MosBar({ label, value, tooltip }: { label: string; value: number; tooltip: string }) {
  const pct = Math.min(100, ((value - 1) / 4) * 100)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm items-center">
        <div className="flex items-center gap-1">
          <span className="text-zinc-500">{label}</span>
          <Tooltip text={tooltip} />
        </div>
        <span className="font-semibold" style={{ color: MOS_COLOR(value) }}>{value.toFixed(3)}</span>
      </div>
      <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: MOS_COLOR(value) }}
        />
      </div>
    </div>
  )
}

export default function QualityCard({ data }: { data: QualityResult }) {
  const chartData = data.samples.map((s, i) => ({
    name: s.position ?? `${Math.round(((i + 0.5) / data.samples.length) * 100)}%`,
    ovrl: s.ovrl,
  }))

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold text-zinc-900">Calidad de audio</h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            {data.duration_s}s · {data.samples.length} muestras de 30s
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Tooltip text={TOOLTIPS.grade} />
          <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${GRADE_COLOR[data.grade]}`}>
            {data.grade}
          </span>
        </div>
      </div>

      {/* MOS scores */}
      <div className="space-y-3">
        <MosBar label="OVRL MOS" value={data.ovrl_mos} tooltip={TOOLTIPS.ovrl} />
        <MosBar label="SIG MOS"  value={data.sig_mos}  tooltip={TOOLTIPS.sig} />
        <MosBar label="BAK MOS"  value={data.bak_mos}  tooltip={TOOLTIPS.bak} />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-zinc-50 rounded-xl p-4">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-xs text-zinc-400 uppercase tracking-wide">SNR</p>
            <Tooltip text={TOOLTIPS.snr} />
          </div>
          <p className="text-2xl font-bold text-zinc-800">
            {data.snr_db} <span className="text-sm font-normal text-zinc-500">dB</span>
          </p>
        </div>
        <div className={`rounded-xl p-4 ${data.clipping ? "bg-red-50" : "bg-zinc-50"}`}>
          <div className="flex items-center gap-1 mb-1">
            <p className="text-xs text-zinc-400 uppercase tracking-wide">Pico máximo</p>
            <Tooltip text={TOOLTIPS.peak} />
          </div>
          <p className={`text-2xl font-bold ${data.clipping ? "text-red-600" : "text-zinc-800"}`}>
            {data.peak_db !== null ? `${data.peak_db} dB` : "—"}
          </p>
          {data.clipping && <p className="text-xs text-red-500 mt-0.5">⚠ Riesgo de clipping</p>}
        </div>
      </div>

      {/* Sample chart */}
      <div>
        <div className="flex items-center gap-1 mb-3">
          <p className="text-xs text-zinc-400 uppercase tracking-wide">OVRL por posición</p>
          <Tooltip text={TOOLTIPS.samples} />
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={chartData} barCategoryGap="30%">
            <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis domain={[1, 5]} hide />
            <RechartsTooltip
              formatter={(v) => [typeof v === "number" ? v.toFixed(3) : v, "OVRL MOS"]}
              contentStyle={{ borderRadius: 8, border: "1px solid #e4e4e7", fontSize: 12 }}
            />
            <Bar dataKey="ovrl" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={MOS_COLOR(entry.ovrl)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
