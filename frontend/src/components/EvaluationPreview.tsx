import type { EvaluationStatusResponse } from '../types/api.ts'

type EvaluationPreviewProps = {
  status: EvaluationStatusResponse | null
}

export function EvaluationPreview({ status }: EvaluationPreviewProps) {
  const state = status?.status ?? 'locked'

  return (
    <section className="panel evaluation-panel" aria-labelledby="evaluation-title">
      <div className="section-header">
        <div>
          <p className="section-kicker">Evaluation Preview</p>
          <h2 id="evaluation-title">Benchmark readiness for retrieval quality experiments.</h2>
        </div>
        <span className={`status-pill status-pill--${state === 'ready' ? 'success' : 'muted'}`}>{state}</span>
      </div>

      <div className="evaluation-layout">
        <div>
          <p className="evaluation-message">{status?.message ?? 'Evaluation status is currently unavailable.'}</p>
          <p className="evaluation-note">
            The UI keeps this honest: metrics need labeled queries with `relevant_ids`, so the project shows readiness
            here instead of pretending benchmark quality that has not been defined yet.
          </p>
        </div>

        <div className="metrics-grid" aria-label="Supported retrieval metrics">
          <span>Precision@k</span>
          <span>Recall@k</span>
          <span>MRR</span>
          <span>NDCG</span>
        </div>
      </div>
    </section>
  )
}
