import type { AnalysisResult, Step } from "./types"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? ""

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function analyzeVideo({
  file,
  url,
  steps,
  label,
  onProgress,
}: {
  file?: File
  url?: string
  steps: Step[]
  label?: string
  onProgress?: (msg: string) => void
}): Promise<AnalysisResult> {
  const form = new FormData()

  if (file) {
    form.append("file", file)
  } else if (url) {
    form.append("url", url)
  } else {
    throw new Error("Debes proporcionar un fichero o una URL")
  }

  form.append("steps", steps.join(","))
  if (label) form.append("label", label)

  onProgress?.("Enviando vídeo a la API...")

  const res = await fetch(`${API_URL}/analyze`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  })

  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new ApiError(res.status, detail?.detail ?? res.statusText)
  }

  onProgress?.("Procesando resultados...")
  return res.json() as Promise<AnalysisResult>
}
