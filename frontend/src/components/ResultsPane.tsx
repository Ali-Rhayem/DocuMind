import type { QueryResponse } from '../types/api.ts'
import { AnswerPanel } from './AnswerPanel.tsx'

type ResultsPaneProps = {
  response: QueryResponse | null
  loading: boolean
  selectedResultId: string | null
  onSelectResult: (resultId: string) => void
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

export function ResultsPane({ response, loading, selectedResultId, onSelectResult }: ResultsPaneProps) {
  return (
    <section className="panel results-panel" aria-labelledby="results-title">
      <div className="section-header">
        <div>
          <p className="section-kicker">Answer + Evidence</p>
          <h2 id="results-title">Generated answer first, ranked citations and retrieval signals underneath.</h2>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-stack" aria-label="Loading retrieval results">
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-card" />
        </div>
      ) : null}

      {!loading && !response ? (
        <div className="empty-state">
          <p className="empty-state__title">Run a retrieval query to populate this evidence stack.</p>
          <p className="empty-state__body">
            The workspace will show ranked chunks, source citations, confidence bars, and scoring signals as soon as
            results arrive.
          </p>
        </div>
      ) : null}

      {!loading && response ? (
        <div className="results-content">
          <AnswerPanel answer={response.answer} />

          <div className="results-summary">
            <div>
              <p className="summary-label">Query</p>
              <p className="summary-value">"{response.query}"</p>
            </div>
            <div className="summary-metrics">
              <span>{response.results.length} ranked results</span>
              <span>{response.indexed_chunks} indexed chunks</span>
              <span>{response.source_count} sources</span>
              <span>{Math.round(response.latency_ms ?? 0)} ms</span>
            </div>
          </div>

          <div className="retrieval-strip" aria-label="Retrieval telemetry">
            <span>Vector {response.retrieval.vector_candidates}</span>
            <span>BM25 {response.retrieval.bm25_candidates}</span>
            <span>Fused {response.retrieval.fused_candidates}</span>
            <span>Final K {response.retrieval.final_k}</span>
          </div>

          {response.results.length === 0 ? (
            <div className="empty-state empty-state--compact">
              <p className="empty-state__title">No evidence matched this question.</p>
              <p className="empty-state__body">Try a broader phrase, rebuild the index, or switch chunking strategy.</p>
            </div>
          ) : null}

          <div className="result-list">
            {response.results.map((item, index) => {
              const active = item.id === selectedResultId || (!selectedResultId && index === 0)

              return (
                <article key={item.id} className={`result-card ${active ? 'result-card--active' : ''}`}>
                  <div className="result-card__top">
                    <div>
                      <p className="result-rank">Rank {index + 1}</p>
                      <h3>{item.citation}</h3>
                    </div>
                    <button type="button" className="ghost-button" onClick={() => onSelectResult(item.id)}>
                      {active ? 'Focused' : 'Focus evidence'}
                    </button>
                  </div>

                  <p className="result-source">{item.source}</p>
                  <p className="result-text">{item.text}</p>

                  <div className="confidence-block" aria-label={`Confidence ${formatPercent(item.confidence)}`}>
                    <div className="confidence-bar">
                      <span style={{ width: `${Math.max(8, item.confidence * 100)}%` }} />
                    </div>
                    <strong>{formatPercent(item.confidence)}</strong>
                  </div>

                  <div className="score-grid">
                    <span>Rerank {item.score.toFixed(3)}</span>
                    <span>Vector {item.vector_score.toFixed(3)}</span>
                    <span>BM25 {item.bm25_score.toFixed(3)}</span>
                    <span>Hybrid {item.hybrid_score.toFixed(3)}</span>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      ) : null}
    </section>
  )
}
