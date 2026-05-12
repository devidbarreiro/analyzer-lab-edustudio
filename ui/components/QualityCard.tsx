"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts"
import type { QualityResult } from "@/lib/types"

const GRADE_COLOR: Record<string, string> = {
  Excelente: "text-emerald-600 bg-emerald-50 border-emerald-200",
  Buena: "text-blue-600 bg-blue-50 border-blue-200",
  Aceptable: "text-amber-600 bg-amber-50 border-amber-200",
  Mejorar: "text-red-600 bg-red-50 border-red-200",
}

const MOS_COLOR = (v: number) => {
  if (v >= 4.0) return "#10b981"
  if (v >= 3.5) return "#3b82f6"
  if (v >= 3.0) return "#f59e0b"
  return "#ef4444"
}

function MosBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, ((value - 1) / 4) * 100)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-zinc-500">{label}</span>
        <span className="font-semibold" style={{ color: MOS_COLOR(value) }}>{value.toFixed(2)}</span>
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
  const chartData = data.samples.map((s) => ({ name: s.position, ovrl: s.ovrl }))

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold text-zinc-900">Calidad de audio</h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            {data.duration_s}s · 5 muestras de 30s
          </p>
        </div>
        <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${GRADE_COLOR[data.grade]}`}>
          {data.grade}
        </span>
      </div>

      {/* MOS scores */}
      <div className="space-y-3">
        <MosBar label="OVRL MOS (global)" value={data.ovrl_mos} />
        <MosBar label="SIG MOS (voz)" value={data.sig_mos} />
        <MosBar label="BAK MOS (fondo)" value={data.bak_mos} />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-zinc-50 rounded-xl p-4">
          <p className="text-xs text-zinc-400 uppercase tracking-wide">SNR</p>
          <p className="text-2xl font-bold text-zinc-800 mt-1">{data.snr_db} <span className="text-sm font-normal text-zinc-500">dB</span></p>
        </div>
        <div className={`rounded-xl p-4 ${data.clipping ? "bg-red-50" : "bg-zinc-50"}`}>
          <p className="text-xs text-zinc-400 uppercase tracking-wide">Pico máximo</p>
          <p className={`text-2xl font-bold mt-1 ${data.clipping ? "text-red-600" : "text-zinc-800"}`}>
            {data.peak_db !== null ? `${data.peak_db} dB` : "—"}
          </p>
          {data.clipping && <p className="text-xs text-red-500 mt-0.5">⚠ Riesgo de clipping</p>}
        </div>
      </div>

      {/* Sample chart */}
      <div>
        <p className="text-xs text-zinc-400 uppercase tracking-wide mb-3">OVRL por posición</p>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={chartData} barCategoryGap="30%">
            <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis domain={[1, 5]} hide />
            <Tooltip
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
