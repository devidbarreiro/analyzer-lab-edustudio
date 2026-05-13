import type { AnalysisResult, Job, Step } from "./types"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? ""

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}` }
}

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new ApiError(res.status, detail?.detail ?? res.statusText)
  }
  if (res.status === 204) return null
  return res.json()
}

// --------------------------------------------------------------------------- //
// Jobs                                                                         //
// --------------------------------------------------------------------------- //

/** Lista todos los jobs */
export async function listJobs(): Promise<Job[]> {
  const data = await apiFetch("/jobs")
  return data.jobs as Job[]
}

/** Devuelve un job por id */
export async function getJob(jobId: string): Promise<Job> {
  return apiFetch(`/jobs/${jobId}`)
}

/** Borra un job y su vídeo */
export async function deleteJob(jobId: string): Promise<void> {
  await apiFetch(`/jobs/${jobId}`, { method: "DELETE" })
}

/** Presigned download URL del vídeo */
export async function getDownloadUrl(jobId: string): Promise<string> {
  const data = await apiFetch(`/jobs/${jobId}/download`)
  return data.url as string
}

// --------------------------------------------------------------------------- //
// Upload flow                                                                  //
// --------------------------------------------------------------------------- //

export interface UploadOptions {
  file: File
  steps: Step[]
  label?: string
  onProgress?: (phase: string, percent: number) => void
}

/**
 * Flujo completo de subida:
 *   1. POST /jobs          → crea job + obtiene presigned PUT URL
 *   2. PUT <presigned>     → sube el fichero directo al bucket (con progreso XHR)
 *   3. POST /jobs/{id}/confirm → arranca el análisis
 *
 * Devuelve el job_id para que la UI pueda hacer polling.
 */
export async function uploadFile({
  file,
  steps,
  label,
  onProgress,
}: UploadOptions): Promise<string> {
  onProgress?.("Creando job...", 0)

  // 1. Crear job
  const { job, upload_url } = await apiFetch("/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      file_size: file.size,
      label: label ?? file.name,
      steps,
      content_type: file.type || "application/octet-stream",
    }),
  })

  const jobId: string = job.id
  onProgress?.("Subiendo al storage...", 2)

  // 2. PUT directo al bucket (XHR para poder rastrear progreso)
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", upload_url)
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 90) + 2 // 2-92%
        onProgress?.(`Subiendo... ${formatBytes(e.loaded)} / ${formatBytes(e.total)}`, pct)
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload falló con status ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error("Error de red durante el upload"))
    xhr.send(file)
  })

  onProgress?.("Encolando análisis...", 93)

  // 3. Confirmar y arrancar análisis
  await apiFetch(`/jobs/${jobId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_size: file.size }),
  })

  onProgress?.("Analizando...", 95)
  return jobId
}

/**
 * Polling hasta que el job termine (done | error).
 * Llama onUpdate en cada poll para que la UI pueda mostrar progreso.
 */
export async function pollJob(
  jobId: string,
  onUpdate: (job: Job) => void,
  intervalMs = 2000,
): Promise<Job> {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const job = await getJob(jobId)
        onUpdate(job)
        if (job.status === "done" || job.status === "error") {
          resolve(job)
        } else {
          setTimeout(tick, intervalMs)
        }
      } catch (err) {
        reject(err)
      }
    }
    tick()
  })
}

// --------------------------------------------------------------------------- //
// Legacy compat (para no romper referencias existentes durante la transición)  //
// --------------------------------------------------------------------------- //

/** @deprecated usa uploadFile + pollJob */
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
  if (!file) throw new Error("Solo se soporta upload de fichero en el nuevo flujo")

  const jobId = await uploadFile({
    file,
    steps,
    label,
    onProgress: (phase) => onProgress?.(phase),
  })

  const job = await pollJob(jobId, (j) => {
    onProgress?.(`${j.status} ${j.progress}%`)
  })

  if (job.status === "error") throw new Error(job.error_msg ?? "Error desconocido")
  return job.results as AnalysisResult
}

// --------------------------------------------------------------------------- //
// Utils                                                                        //
// --------------------------------------------------------------------------- //

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
