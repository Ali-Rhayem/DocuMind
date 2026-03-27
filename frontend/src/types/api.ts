export type ChunkStrategy = 'fixed' | 'sliding' | 'heading' | 'semantic'

export type HealthResponse = {
  status: string
}

export type IndexStatsResponse = {
  collection: string
  indexed_chunks: number
  source_count: number
  status: 'ready' | 'empty'
}

export type DocumentMetadata = {
  filename?: string
  extension?: string
  size_bytes?: number
  loaded_at?: string
  source_kind?: string
  ocr_used?: boolean
  ocr_avg_confidence?: number
  ocr_line_count?: number
}

export type DocumentPreview = {
  name: string
  type: string
  size_mb: number
  indexed: boolean
  indexed_chunks: number
}

export type IngestionPreviewResponse = {
  count: number
  documents: DocumentPreview[]
}

export type RetrievalSummary = {
  vector_candidates: number
  bm25_candidates: number
  fused_candidates: number
  final_k: number
}

export type RAGAnswer = {
  text: string
  citations: string[]
  provider: string
  model: string
  status: 'generated' | 'fallback' | 'empty'
  reason: string
  latency_ms?: number
}

export type RAGResult = {
  id: string
  score: number
  vector_score: number
  bm25_score: number
  hybrid_score: number
  confidence: number
  citation: string
  source: string
  chunk_index: number
  text: string
  metadata: DocumentMetadata
}

export type QueryRequest = {
  query: string
  k: number
  chunk_size: number
  chunk_strategy: ChunkStrategy
  overlap: number
  build_if_empty: boolean
}

export type QueryResponse = {
  query: string
  indexed_chunks: number
  source_count: number
  latency_ms?: number
  answer: RAGAnswer
  retrieval: RetrievalSummary
  results: RAGResult[]
}

export type IndexRequest = {
  chunk_size: number
  chunk_strategy: ChunkStrategy
  overlap: number
}

export type IndexResponse = {
  status: string
  collection: string
  indexed_chunks: number
  source_count?: number
  skipped_documents?: number
  removed_chunks?: number
  processed_documents?: number
  vector_size?: number
  chunk_size?: number
  chunk_strategy: ChunkStrategy
  overlap: number
  build_time_seconds?: number
  message?: string
}

export type EvaluationStatusResponse = {
  enabled: boolean
  status: 'ready' | 'locked'
  message: string
}

export type UploadItem = {
  filename: string
  size_bytes: number
  path: string
  action: 'created' | 'replaced'
}

export type UploadSkipped = {
  filename: string
  reason: string
}

export type UploadRejection = {
  filename: string
  reason: string
}

export type UploadResponse = {
  status: string
  uploaded_count: number
  uploaded: UploadItem[]
  skipped: UploadSkipped[]
  rejected: UploadRejection[]
}

export type DeleteDocumentResponse = {
  status: string
  deleted_file: string
  removed_chunks: number
}
