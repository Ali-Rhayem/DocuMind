import type { RAGAnswer } from '../types/api.ts'

type AnswerPanelProps = {
  answer: RAGAnswer
}

export function AnswerPanel({ answer }: AnswerPanelProps) {
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
            <span key={citation} className="type-chip">
              {citation}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}
