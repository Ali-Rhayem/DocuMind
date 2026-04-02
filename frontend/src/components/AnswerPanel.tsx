import type { RAGAnswer, RAGResult } from '../types/api.ts'

type AnswerPanelProps = {
  answer: RAGAnswer
  results?: RAGResult[]
}

function getFileDownloadUrl(filename: string | undefined, pageNumber?: number): string {
  if (!filename) return ''
  const encoded = encodeURIComponent(filename)
  const apiBaseUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : 'http://localhost:8000'
  const url = `${apiBaseUrl}/files/${encoded}`
  return pageNumber ? `${url}#page=${pageNumber}` : url
}

function handleCitationClick(citation: string, results?: RAGResult[]) {
  if (!results) return

  // Find the result matching this citation
  const result = results.find((r) => r.citation === citation)
  if (!result || !result.metadata?.filename) return

  const exactPage =
    typeof result.metadata.page_number === 'number' && result.metadata.page_number > 0
      ? Math.floor(result.metadata.page_number)
      : Math.max(1, Math.floor(result.chunk_index / 3) + 1)
  const fileUrl = getFileDownloadUrl(result.metadata.filename, exactPage)
  window.open(fileUrl, '_blank')
}

export function AnswerPanel({ answer, results }: AnswerPanelProps) {
  const statusLabel =
    answer.status === 'generated' ? 'Generated answer' : answer.status === 'fallback' ? 'Evidence summary' : 'No answer'

  return (
    <section className="answer-panel-card" aria-label="Generated answer">
      <div className="answer-panel-card__header">
        <div>
          <p className="section-kicker">Answer</p>
          <h3>{statusLabel}</h3>
        </div>
        <div className="answer-badges">
          <span className="status-pill status-pill--success">{answer.provider}</span>
          <span className="status-pill status-pill--muted">{answer.model}</span>
          <span className="status-pill status-pill--muted">{Math.round(answer.latency_ms ?? 0)} ms</span>
        </div>
      </div>

      <p className="answer-copy">{answer.text}</p>

      {answer.citations.length > 0 ? (
        <div className="citation-row" aria-label="Answer citations">
          {answer.citations.map((citation) => (
            <button
              key={citation}
              type="button"
              className="type-chip type-chip--clickable"
              onClick={() => handleCitationClick(citation, results)}
              title="Click to open source document"
            >
              {citation}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
