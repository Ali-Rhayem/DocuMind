import { startTransition, useEffect, useState } from 'react'
import './App.css'
import { HeroStatus } from './components/HeroStatus.tsx'
import { QueryWorkbench } from './components/QueryWorkbench.tsx'
import { ResultsPane } from './components/ResultsPane.tsx'
import { EvidenceDrawer } from './components/EvidenceDrawer.tsx'
import { SystemOverview } from './components/SystemOverview.tsx'
import { EvaluationPreview } from './components/EvaluationPreview.tsx'
import {
  getEvaluationStatus,
  getHealth,
  getIngestionPreview,
  getIndexStats,
  rebuildIndex,
  runQuery,
} from './lib/api.ts'
import type {
  DocumentPreview,
  EvaluationStatusResponse,
  IndexRequest,
  IndexStatsResponse,
  QueryRequest,
  QueryResponse,
} from './types/api.ts'

const quickPrompts = [
  'What is DocuMind?',
  'How does OCR fallback work in this project?',
  'Which chunking strategies are available?',
]

const defaultQueryForm: QueryRequest = {
  query: quickPrompts[0],
  k: 4,
  chunk_size: 500,
  chunk_strategy: 'semantic',
  overlap: 100,
  build_if_empty: true,
}

function App() {
  const [backendStatus, setBackendStatus] = useState('checking')
  const [indexStats, setIndexStats] = useState<IndexStatsResponse | null>(null)
  const [documents, setDocuments] = useState<DocumentPreview[]>([])
  const [evaluationStatus, setEvaluationStatus] = useState<EvaluationStatusResponse | null>(null)
  const [dashboardNotice, setDashboardNotice] = useState('')
  const [queryForm, setQueryForm] = useState<QueryRequest>(defaultQueryForm)
  const [queryResponse, setQueryResponse] = useState<QueryResponse | null>(null)
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null)
  const [queryError, setQueryError] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [dashboardRefreshing, setDashboardRefreshing] = useState(false)
  const [queryLoading, setQueryLoading] = useState(false)
  const [rebuildLoading, setRebuildLoading] = useState(false)

  const selectedResult =
    queryResponse?.results.find((item) => item.id === selectedResultId) ?? queryResponse?.results[0] ?? null

  const documentCount = documents.length
  const ocrCount = documents.filter((document) => document.metadata.ocr_used === true).length
  const totalSizeBytes = documents.reduce((sum, document) => {
    const size = typeof document.metadata.size_bytes === 'number' ? document.metadata.size_bytes : 0
    return sum + size
  }, 0)
  const fileTypeCounts = documents.reduce<Record<string, number>>((accumulator, document) => {
    const extension =
      typeof document.metadata.extension === 'string' && document.metadata.extension.length > 0
        ? document.metadata.extension
        : 'unknown'
    accumulator[extension] = (accumulator[extension] ?? 0) + 1
    return accumulator
  }, {})

  useEffect(() => {
    void refreshDashboard('initial')
  }, [])

  async function refreshDashboard(mode: 'initial' | 'refresh') {
    if (mode === 'initial') {
      setDashboardLoading(true)
    } else {
      setDashboardRefreshing(true)
    }

    setDashboardNotice('')

    const [healthResult, statsResult, previewResult, evaluationResult] = await Promise.allSettled([
      getHealth(),
      getIndexStats(),
      getIngestionPreview(),
      getEvaluationStatus(),
    ])

    if (healthResult.status === 'fulfilled') {
      setBackendStatus(healthResult.value.status)
    } else {
      setBackendStatus('offline')
      setDashboardNotice(healthResult.reason instanceof Error ? healthResult.reason.message : 'Backend unavailable.')
    }

    if (statsResult.status === 'fulfilled') {
      setIndexStats(statsResult.value)
    } else {
      setIndexStats(null)
    }

    if (previewResult.status === 'fulfilled') {
      setDocuments(previewResult.value.documents)
    } else {
      setDocuments([])
    }

    if (evaluationResult.status === 'fulfilled') {
      setEvaluationStatus(evaluationResult.value)
    } else {
      setEvaluationStatus({
        enabled: false,
        status: 'locked',
        message: 'Evaluation status is unavailable right now.',
      })
    }

    if (statsResult.status === 'rejected' || previewResult.status === 'rejected') {
      setDashboardNotice((current) => current || 'Some dashboard panels are temporarily unavailable.')
    }

    setDashboardLoading(false)
    setDashboardRefreshing(false)
  }

  function updateForm<K extends keyof QueryRequest>(field: K, value: QueryRequest[K]) {
    setQueryForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function applyPrompt(prompt: string) {
    setQueryForm((current) => ({
      ...current,
      query: prompt,
    }))
    setQueryError('')
  }

  async function handleRunQuery() {
    if (!queryForm.query.trim()) {
      setQueryError('Enter a question before running retrieval.')
      return
    }

    setQueryLoading(true)
    setQueryError('')
    setActionNotice('')

    try {
      const payload = await runQuery(queryForm)
      startTransition(() => {
        setQueryResponse(payload)
        setSelectedResultId(payload.results[0]?.id ?? null)
      })

      setActionNotice(
        payload.results.length > 0
          ? `Retrieved ${payload.results.length} evidence chunks in ${Math.round(payload.latency_ms ?? 0)} ms.`
          : 'The query completed, but no relevant evidence was found.'
      )
      await refreshDashboard('refresh')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Query failed.'
      setQueryError(message)
      setQueryResponse(null)
      setSelectedResultId(null)
    } finally {
      setQueryLoading(false)
    }
  }

  async function handleRebuild() {
    const payload: IndexRequest = {
      chunk_size: queryForm.chunk_size,
      chunk_strategy: queryForm.chunk_strategy,
      overlap: queryForm.overlap,
    }

    setRebuildLoading(true)
    setActionNotice('')
    setQueryError('')

    try {
      const response = await rebuildIndex(payload)
      setActionNotice(
        response.status === 'ok'
          ? `Rebuilt the index with ${response.indexed_chunks} chunks using ${response.chunk_strategy} chunking.`
          : response.message ?? 'No chunkable documents were found during rebuild.'
      )
      await refreshDashboard('refresh')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Index rebuild failed.'
      setQueryError(message)
    } finally {
      setRebuildLoading(false)
    }
  }

  return (
    <main className="app-shell">
      <HeroStatus
        backendStatus={backendStatus}
        indexStats={indexStats}
        documentCount={documentCount}
        ocrCount={ocrCount}
        quickPrompts={quickPrompts}
        onPromptSelect={applyPrompt}
        evaluationStatus={evaluationStatus}
        dashboardRefreshing={dashboardRefreshing}
      />

      <QueryWorkbench
        form={queryForm}
        advancedOpen={advancedOpen}
        queryLoading={queryLoading}
        rebuildLoading={rebuildLoading}
        notice={actionNotice}
        error={queryError}
        onFieldChange={updateForm}
        onToggleAdvanced={() => setAdvancedOpen((current) => !current)}
        onRunQuery={handleRunQuery}
        onRebuild={handleRebuild}
      />

      <section className="workspace-grid" aria-label="Retrieval workspace">
        <ResultsPane
          response={queryResponse}
          loading={queryLoading}
          selectedResultId={selectedResultId}
          onSelectResult={setSelectedResultId}
        />
        <EvidenceDrawer result={selectedResult} isOpen={Boolean(selectedResult)} onClose={() => setSelectedResultId(null)} />
      </section>

      <SystemOverview
        indexStats={indexStats}
        documents={documents}
        fileTypeCounts={fileTypeCounts}
        totalSizeBytes={totalSizeBytes}
        ocrCount={ocrCount}
        notice={dashboardNotice}
        loading={dashboardLoading}
      />

      <EvaluationPreview status={evaluationStatus} />
    </main>
  )
}

export default App
