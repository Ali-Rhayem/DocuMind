import type { QueryRequest } from '../types/api.ts'

type QueryWorkbenchProps = {
  form: QueryRequest
  advancedOpen: boolean
  queryLoading: boolean
  rebuildLoading: boolean
  notice: string
  error: string
  onFieldChange: <K extends keyof QueryRequest>(field: K, value: QueryRequest[K]) => void
  onToggleAdvanced: () => void
  onRunQuery: () => void
  onRebuild: () => void
}

const chunkStrategies: Array<{ value: QueryRequest['chunk_strategy']; label: string }> = [
  { value: 'semantic', label: 'Semantic' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'sliding', label: 'Sliding' },
  { value: 'heading', label: 'Heading-aware' },
]

export function QueryWorkbench({
  form,
  advancedOpen,
  queryLoading,
  rebuildLoading,
  notice,
  error,
  onFieldChange,
  onToggleAdvanced,
  onRunQuery,
  onRebuild,
}: QueryWorkbenchProps) {
  return (
    <section className="panel query-panel" aria-labelledby="query-title">
      <div className="section-header">
        <div>
          <p className="section-kicker">Query Workbench</p>
          <h2 id="query-title">Run retrieval, tune the index, and inspect the evidence trail.</h2>
        </div>
        <button type="button" className="ghost-button advanced-toggle" onClick={onToggleAdvanced}>
          {advancedOpen ? 'Hide advanced controls' : 'Show advanced controls'}
        </button>
      </div>

      <div className="query-layout">
        <div className="query-main">
          <label className="field-label" htmlFor="query-input">
            Ask your corpus
          </label>
          <textarea
            id="query-input"
            className="query-textarea"
            rows={6}
            value={form.query}
            onChange={(event) => onFieldChange('query', event.target.value)}
            placeholder="Ask a question that should be answered by your indexed documents."
          />

          <div className="inline-options">
            <label className="checkbox-option">
              <input
                type="checkbox"
                checked={form.build_if_empty}
                onChange={(event) => onFieldChange('build_if_empty', event.target.checked)}
              />
              Auto-build the index if it is empty
            </label>
          </div>

          <div className="action-row">
            <button type="button" className="primary-button" onClick={onRunQuery} disabled={queryLoading}>
              {queryLoading ? 'Running retrieval...' : 'Run Retrieval'}
            </button>
            <button type="button" className="secondary-button" onClick={onRebuild} disabled={rebuildLoading}>
              {rebuildLoading ? 'Rebuilding index...' : 'Rebuild Index'}
            </button>
          </div>

          {notice ? <p className="inline-message inline-message--success">{notice}</p> : null}
          {error ? <p className="inline-message inline-message--error">{error}</p> : null}
        </div>

        <div className={`query-controls ${advancedOpen ? 'query-controls--open' : ''}`}>
          <div className="control-grid">
            <label className="control-field">
              <span className="field-label">Chunk Strategy</span>
              <select
                value={form.chunk_strategy}
                onChange={(event) => onFieldChange('chunk_strategy', event.target.value as QueryRequest['chunk_strategy'])}
              >
                {chunkStrategies.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-field">
              <span className="field-label">Top K</span>
              <input
                type="number"
                min={1}
                max={20}
                value={form.k}
                onChange={(event) => onFieldChange('k', Number(event.target.value))}
              />
            </label>

            <label className="control-field">
              <span className="field-label">Chunk Size</span>
              <input
                type="number"
                min={100}
                max={2000}
                step={50}
                value={form.chunk_size}
                onChange={(event) => onFieldChange('chunk_size', Number(event.target.value))}
              />
            </label>

            <label className="control-field">
              <span className="field-label">Overlap</span>
              <input
                type="number"
                min={0}
                max={1500}
                step={25}
                value={form.overlap}
                onChange={(event) => onFieldChange('overlap', Number(event.target.value))}
              />
            </label>
          </div>

          <div className="control-note">
            <p className="field-label">Live config preview</p>
            <p>
              Retrieval will use <strong>{form.chunk_strategy}</strong> chunks sized at <strong>{form.chunk_size}</strong>{' '}
              characters with <strong>{form.overlap}</strong> overlap and a final top <strong>{form.k}</strong> results.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
