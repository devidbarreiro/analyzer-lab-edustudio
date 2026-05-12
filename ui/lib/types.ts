export type Step = "quality" | "speakers" | "denoise"

export interface QualitySample {
  position: string
  ovrl: number
  sig: number
  bak: number
}

export interface QualityResult {
  file: string
  duration_s: number
  sig_mos: number
  bak_mos: number
  ovrl_mos: number
  snr_db: number
  peak_db: number | null
  clipping: boolean
  grade: "Excelente" | "Buena" | "Aceptable" | "Mejorar"
  samples: QualitySample[]
}

export interface SpeakerSummary {
  label: string
  total_seconds: number
  percentage: number
  is_main: boolean
  turns_count: number
}

export interface SpeakerTurn {
  speaker: string
  start_seconds: number
  end_seconds: number
  duration_seconds: number
  start_fmt: string
  end_fmt: string
  is_main: boolean
}

export interface SpeakersResult {
  speakers: SpeakerSummary[]
  turns: SpeakerTurn[]
  total_speech_seconds: number
  num_speakers: number
}

export interface DnsMosScores {
  sig_mos: number
  bak_mos: number
  ovrl_mos: number
}

export interface DenoiseResult {
  before: DnsMosScores
  after: DnsMosScores
  delta: DnsMosScores
  improvement: number
  worth_denoising: boolean
  analysis_offset_s: number
  analysis_duration_s: number
}

export interface AnalysisResult {
  file: string
  steps_run: Step[]
  quality?: QualityResult
  speakers?: SpeakersResult
  denoise?: DenoiseResult
}
