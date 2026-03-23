import type { EvaluationStatusResponse, IndexStatsResponse } from '../types/api.ts'

type HeroStatusProps = {
  backendStatus: string
  indexStats: IndexStatsResponse | null
  documentCount: number
  ocrCount: number
  quickPrompts: string[]
  onPromptSelect: (prompt: string) => void
  evaluationStatus: EvaluationStatusResponse | null
  dashboardRefreshing: boolean
}

const statusToneMap = {
  ok: 'success',
  ready: 'success',
  empty: 'muted',
  locked: 'muted',
  offline: 'danger',
  checking: 'muted',
} as const

function getTone(value: string | undefined) {
  if (!value) {
    return 'muted'
  }

  return statusToneMap[value as keyof typeof statusToneMap] ?? 'muted'
}

export function HeroStatus({
  backendStatus,
  indexStats,
  documentCount,
  ocrCount,
  quickPrompts,
  onPromptSelect,
  evaluationStatus,
  dashboardRefreshing,
}: HeroStatusProps) {
  return (
    <section className="hero-panel panel">
      <div className="hero-copy">
        <p className="eyebrow">Phase 5 / Editorial-Premium RAG Workspace</p>
        <h1>
          DocuMind turns raw documents into a
          <span> retrieval experience you can trust.</span>
        </h1>
        <p className="hero-summary">
          Inspect evidence, surface OCR-backed sources, compare chunking choices, and present the system like a
          serious AI product instead of a prototype.
        </p>

        <div className="status-row" aria-label="System status">
          <span className={`status-pill status-pill--${getTone(backendStatus)}`}>Backend {backendStatus}</span>
          <span className={`status-pill status-pill--${getTone(indexStats?.status)}`}>
            Index {indexStats?.status ?? 'unknown'}
          </span>
          <span className={`status-pill status-pill--${getTone(evaluationStatus?.status)}`}>
            Evaluation {evaluationStatus?.status ?? 'unknown'}
          </span>
          {dashboardRefreshing ? <span className="status-pill status-pill--muted">Refreshing live data</span> : null}
        </div>

        <div className="prompt-row" aria-label="Quick prompt suggestions">
          {quickPrompts.map((prompt) => (
            <button key={prompt} type="button" className="prompt-chip" onClick={() => onPromptSelect(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      </div>

      <div className="hero-metrics">
        <article className="metric-card accent-card">
          <p className="metric-label">Indexed Chunks</p>
          <p className="metric-value">{indexStats?.indexed_chunks ?? 0}</p>
          <p className="metric-meta">Collection: {indexStats?.collection ?? 'documents'}</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">Documents</p>
          <p className="metric-value">{documentCount}</p>
          <p className="metric-meta">Source files visible to the workspace</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">OCR-Backed</p>
          <p className="metric-value">{ocrCount}</p>
          <p className="metric-meta">Documents relying on OCR extraction</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">Source Count</p>
          <p className="metric-value">{indexStats?.source_count ?? documentCount}</p>
          <p className="metric-meta">Indexed sources ready for retrieval</p>
        </article>
      </div>
    </section>
  )
}
