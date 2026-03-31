import type {
  DeleteDocumentResponse,
  EvaluationStatusResponse,
  HealthResponse,
  IndexRequest,
  IndexResponse,
  IndexStatsResponse,
  IngestionPreviewResponse,
  QueryRequest,
  QueryResponse,
  UploadResponse,
} from '../types/api.ts'

const defaultApiBaseUrl =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : 'http://localhost:8000'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? defaultApiBaseUrl).replace(/\/+$/, '')

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init)

  if (!response.ok) {
    let detail = `Request failed with HTTP ${response.status}.`

    try {
      const payload = (await response.json()) as { detail?: string }
      if (typeof payload.detail === 'string' && payload.detail.length > 0) {
        detail = payload.detail
      }
    } catch {
      // Ignore JSON parsing errors and fall back to the default message.
    }

    throw new Error(detail)
  }

  return (await response.json()) as T
}

export function getHealth() {
  return requestJson<HealthResponse>('/health')
}

export function getIndexStats() {
  return requestJson<IndexStatsResponse>('/index/stats')
}

export function getIngestionPreview() {
  return requestJson<IngestionPreviewResponse>('/ingestion/preview')
}

export function getEvaluationStatus() {
  return requestJson<EvaluationStatusResponse>('/evaluation/status')
}

export function runQuery(payload: QueryRequest) {
  return requestJson<QueryResponse>('/rag/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function rebuildIndex(payload: IndexRequest) {
  return requestJson<IndexResponse>('/index/rebuild', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function uploadDocuments(files: File[]) {
  const formData = new FormData()
  files.forEach((file) => {
    formData.append('files', file)
  })

  const response = await fetch(`${API_BASE_URL}/ingestion/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    let detail = `Upload failed with HTTP ${response.status}.`

    try {
      const payload = (await response.json()) as { detail?: string }
      if (typeof payload.detail === 'string' && payload.detail.length > 0) {
        detail = payload.detail
      }
    } catch {
      // Ignore JSON parsing errors and fall back to the default message.
    }

    throw new Error(detail)
  }

  return (await response.json()) as UploadResponse
}

export function deleteDocument(fileName: string) {
  return requestJson<DeleteDocumentResponse>(`/ingestion/files/${encodeURIComponent(fileName)}`, {
    method: 'DELETE',
  })
}
