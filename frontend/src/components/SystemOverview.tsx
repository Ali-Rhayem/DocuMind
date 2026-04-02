import type { DocumentPreview, IndexStatsResponse } from '../types/api.ts'

type SystemOverviewProps = {
  indexStats: IndexStatsResponse | null
  documents: DocumentPreview[]
  fileTypeCounts: Record<string, number>
  totalSizeBytes: number
  ocrCount: number
  notice: string
  uploadNotice: string
  pendingFiles: File[]
  uploadLoading: boolean
  loading: boolean
  onFilesSelected: (files: FileList | null) => void
  onUpload: () => void
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

function getFileDownloadUrl(filename: string): string {
  const encoded = encodeURIComponent(filename)
  const apiBaseUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : 'http://localhost:8000'
  return `${apiBaseUrl}/files/${encoded}`
}

function handleDocumentClick(documentName: string) {
  const fileUrl = getFileDownloadUrl(documentName)
  window.open(fileUrl, '_blank')
}

export function SystemOverview({
  indexStats,
  documents,
  fileTypeCounts,
  totalSizeBytes,
  ocrCount,
  notice,
  uploadNotice,
  pendingFiles,
  uploadLoading,
  loading,
  onFilesSelected,
  onUpload,
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

      <div className="upload-card">
        <div className="subsection-heading">
          <div>
            <h3>Upload documents</h3>
            <span>Drag in your corpus through the app instead of editing folders manually.</span>
          </div>
        </div>
        <div className="upload-actions">
          <label className="upload-input" key={pendingFiles.length === 0 ? 'upload-empty' : 'upload-selected'}>
            <span>Select files</span>
            <input
              type="file"
              multiple
              accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.bmp,.tiff,.webp"
              onChange={(event) => onFilesSelected(event.target.files)}
            />
          </label>
          <button type="button" className="primary-button" onClick={onUpload} disabled={uploadLoading}>
            {uploadLoading ? 'Uploading and indexing...' : 'Upload and Index'}
          </button>
        </div>
        <div className="type-chip-grid">
          {pendingFiles.length > 0 ? (
            pendingFiles.map((file) => (
              <span key={`${file.name}-${file.size}`} className="type-chip">
                {file.name}
              </span>
            ))
          ) : (
            <span className="type-chip">No files selected</span>
          )}
        </div>
        {uploadNotice ? <p className="inline-message inline-message--success">{uploadNotice}</p> : null}
      </div>

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
              <button
                key={document.name}
                type="button"
                className="source-item source-item--clickable"
                onClick={() => handleDocumentClick(document.name)}
                title={`Click to open ${document.name}`}
              >
                <div>
                  <p className="source-item__title">{document.name}</p>
                  <p className="source-item__meta">
                    {document.type.toUpperCase()} / {document.indexed ? `Indexed (${document.indexed_chunks} chunks)` : 'Not indexed'}
                  </p>
                </div>
                <span className="source-item__size">{`${document.size_mb.toFixed(2)} MB`}</span>
              </button>
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
