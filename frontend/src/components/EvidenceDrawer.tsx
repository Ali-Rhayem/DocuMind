import type { RAGResult } from '../types/api.ts'

type EvidenceDrawerProps = {
  result: RAGResult | null
  isOpen: boolean
  onClose: () => void
}

function formatSize(bytes: number | undefined) {
  if (!bytes) {
    return 'n/a'
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function EvidenceDrawer({ result, isOpen, onClose }: EvidenceDrawerProps) {
  const metadata = result?.metadata

  return (
    <>
      <div className={`drawer-scrim ${isOpen ? 'drawer-scrim--visible' : ''}`} onClick={onClose} />
      <aside className={`panel evidence-panel ${isOpen ? 'evidence-panel--open' : ''}`} aria-labelledby="evidence-title">
        <div className="evidence-header">
          <div>
            <p className="section-kicker">Focused Evidence</p>
            <h2 id="evidence-title">{result ? result.citation : 'Choose a result to inspect it in detail.'}</h2>
          </div>
          <button type="button" className="ghost-button evidence-close" onClick={onClose}>
            Close
          </button>
        </div>

        {result ? (
          <div className="evidence-content">
            <div className="evidence-meta">
              <span>Source {metadata?.filename ?? result.source}</span>
              <span>Chunk {result.chunk_index}</span>
              <span>Confidence {Math.round(result.confidence * 100)}%</span>
            </div>

            <div className="evidence-copy">
              <p>{result.text}</p>
            </div>

            <dl className="metadata-grid">
              <div>
                <dt>Extension</dt>
                <dd>{metadata?.extension ?? 'n/a'}</dd>
              </div>
              <div>
                <dt>Source Kind</dt>
                <dd>{metadata?.source_kind ?? 'file'}</dd>
              </div>
              <div>
                <dt>OCR Used</dt>
                <dd>{metadata?.ocr_used ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt>OCR Confidence</dt>
                <dd>{metadata?.ocr_avg_confidence ? `${Math.round(metadata.ocr_avg_confidence * 100)}%` : 'n/a'}</dd>
              </div>
              <div>
                <dt>OCR Lines</dt>
                <dd>{metadata?.ocr_line_count ?? 'n/a'}</dd>
              </div>
              <div>
                <dt>File Size</dt>
                <dd>{formatSize(metadata?.size_bytes)}</dd>
              </div>
            </dl>

            <div className="score-grid score-grid--detail">
              <span>Rerank {result.score.toFixed(3)}</span>
              <span>Vector {result.vector_score.toFixed(3)}</span>
              <span>BM25 {result.bm25_score.toFixed(3)}</span>
              <span>Hybrid {result.hybrid_score.toFixed(3)}</span>
            </div>
          </div>
        ) : (
          <div className="empty-state empty-state--compact">
            <p className="empty-state__title">Nothing is focused yet.</p>
            <p className="empty-state__body">
              Select a ranked result to inspect its source metadata, OCR signals, and retrieval score breakdown.
            </p>
          </div>
        )}
      </aside>
    </>
  )
}
