import type { DocumentPreview, IndexStatsResponse } from '../types/api.ts'

type SystemOverviewProps = {
  indexStats: IndexStatsResponse | null
  documents: DocumentPreview[]
  fileTypeCounts: Record<string, number>
  totalSizeBytes: number
  ocrCount: number
  notice: string
  loading: boolean
}

function formatSize(bytes: number) {
  if (bytes <= 0) {
    return '0 B'
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function SystemOverview({
  indexStats,
  documents,
  fileTypeCounts,
  totalSizeBytes,
  ocrCount,
  notice,
  loading,
}: SystemOverviewProps) {
  const sourcePreview = documents.slice(0, 5)
  const fileTypes = Object.entries(fileTypeCounts).sort((left, right) => right[1] - left[1])

  return (
    <section className="panel system-panel" aria-labelledby="system-title">
      <div className="section-header">
        <div>
          <p className="section-kicker">System Overview</p>
          <h2 id="system-title">Document inventory, index health, and ingestion readiness.</h2>
        </div>
      </div>

      {notice ? <p className="inline-message inline-message--warning">{notice}</p> : null}

      <div className="overview-grid">
        <article className="overview-card">
          <p className="metric-label">Collection Health</p>
          <p className="metric-value">{indexStats?.status ?? 'unknown'}</p>
          <p className="metric-meta">{indexStats?.indexed_chunks ?? 0} chunks ready for retrieval</p>
        </article>
        <article className="overview-card">
          <p className="metric-label">Corpus Size</p>
          <p className="metric-value">{documents.length}</p>
          <p className="metric-meta">{formatSize(totalSizeBytes)} across visible source files</p>
        </article>
        <article className="overview-card">
          <p className="metric-label">OCR Coverage</p>
          <p className="metric-value">{ocrCount}</p>
          <p className="metric-meta">Files extracted with OCR assistance</p>
        </article>
      </div>

      <div className="system-layout">
        <div className="source-list">
          <div className="subsection-heading">
            <h3>Document preview</h3>
            <span>{loading ? 'Refreshing...' : `${documents.length} files`}</span>
          </div>

          {sourcePreview.length > 0 ? (
            sourcePreview.map((document) => (
              <article key={document.id} className="source-item">
                <div>
                  <p className="source-item__title">{document.metadata.filename ?? document.source}</p>
                  <p className="source-item__meta">
                    {document.metadata.extension ?? 'unknown'} / {document.metadata.ocr_used ? 'OCR-backed' : 'Native text'}
                  </p>
                </div>
                <span className="source-item__size">
                  {typeof document.metadata.size_bytes === 'number' ? formatSize(document.metadata.size_bytes) : 'n/a'}
                </span>
              </article>
            ))
          ) : (
            <div className="empty-state empty-state--compact">
              <p className="empty-state__title">No source files detected.</p>
              <p className="empty-state__body">Place supported documents in `backend/data` to populate the workspace.</p>
            </div>
          )}
        </div>

        <div className="source-types">
          <div className="subsection-heading">
            <h3>File types</h3>
            <span>{fileTypes.length} detected</span>
          </div>
          <div className="type-chip-grid">
            {fileTypes.length > 0 ? (
              fileTypes.map(([extension, count]) => (
                <span key={extension} className="type-chip">
                  {extension} / {count}
                </span>
              ))
            ) : (
              <span className="type-chip">No files indexed yet</span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
