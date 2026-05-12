"use client"

import type { SpeakersResult } from "@/lib/types"

const SPEAKER_COLORS = [
  "bg-blue-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-cyan-500",
]

const SPEAKER_COLORS_LIGHT = [
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
]

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

export default function SpeakersCard({ data }: { data: SpeakersResult }) {
  const totalSpeech = data.total_speech_seconds

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold text-zinc-900">Diarización de hablantes</h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            {data.num_speakers} hablantes · {fmt(data.total_speech_seconds)} de habla total
          </p>
        </div>
      </div>

      {/* Speaker breakdown */}
      <div className="space-y-3">
        {data.speakers.map((spk, i) => (
          <div key={spk.label} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SPEAKER_COLORS_LIGHT[i % SPEAKER_COLORS_LIGHT.length]}`}>
                  {spk.label}
                </span>
                {spk.is_main && (
                  <span className="text-xs text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full">Hablante principal</span>
                )}
              </div>
              <div className="text-right">
                <span className="text-sm font-semibold text-zinc-700">{spk.percentage}%</span>
                <span className="text-xs text-zinc-400 ml-2">{fmt(spk.total_seconds)} · {spk.turns_count} turnos</span>
              </div>
            </div>
            <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${SPEAKER_COLORS[i % SPEAKER_COLORS.length]} transition-all duration-700`}
                style={{ width: `${spk.percentage}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Timeline */}
      {data.turns.length > 0 && (
        <div>
          <p className="text-xs text-zinc-400 uppercase tracking-wide mb-3">Timeline de turnos</p>
          <div className="relative h-8 bg-zinc-100 rounded-lg overflow-hidden">
            {data.turns.map((turn, i) => {
              const speakerIdx = data.speakers.findIndex(s => s.label === turn.speaker)
              const left = totalSpeech > 0 ? (turn.start_seconds / totalSpeech) * 100 : 0
              const width = totalSpeech > 0 ? (turn.duration_seconds / totalSpeech) * 100 : 0
              return (
                <div
                  key={i}
                  title={`${turn.speaker}: ${turn.start_fmt} → ${turn.end_fmt}`}
                  className={`absolute top-0 h-full opacity-80 ${SPEAKER_COLORS[speakerIdx % SPEAKER_COLORS.length]}`}
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.3)}%` }}
                />
              )
            })}
          </div>
          <div className="flex justify-between text-xs text-zinc-400 mt-1">
            <span>0:00</span>
            <span>{fmt(totalSpeech)}</span>
          </div>
        </div>
      )}

      {/* Turns table (primeros 10) */}
      {data.turns.length > 0 && (
        <div>
          <p className="text-xs text-zinc-400 uppercase tracking-wide mb-2">Primeros turnos</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100">
                  <th className="text-left py-2 text-xs text-zinc-400 font-medium">Hablante</th>
                  <th className="text-left py-2 text-xs text-zinc-400 font-medium">Inicio</th>
                  <th className="text-left py-2 text-xs text-zinc-400 font-medium">Fin</th>
                  <th className="text-right py-2 text-xs text-zinc-400 font-medium">Duración</th>
                </tr>
              </thead>
              <tbody>
                {data.turns.slice(0, 10).map((turn, i) => {
                  const speakerIdx = data.speakers.findIndex(s => s.label === turn.speaker)
                  return (
                    <tr key={i} className="border-b border-zinc-50 hover:bg-zinc-50">
                      <td className="py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${SPEAKER_COLORS_LIGHT[speakerIdx % SPEAKER_COLORS_LIGHT.length]}`}>
                          {turn.speaker}
                        </span>
                      </td>
                      <td className="py-2 text-zinc-600 font-mono text-xs">{turn.start_fmt}</td>
                      <td className="py-2 text-zinc-600 font-mono text-xs">{turn.end_fmt}</td>
                      <td className="py-2 text-zinc-600 font-mono text-xs text-right">{fmt(turn.duration_seconds)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {data.turns.length > 10 && (
              <p className="text-xs text-zinc-400 mt-2">+ {data.turns.length - 10} turnos más</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
