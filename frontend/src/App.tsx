import { useEffect, useState } from 'react'
import './App.css'

type RAGResult = {
  id: string
  score: number
  distance: number
  source: string
  chunk_index: number
  text: string
}

type RAGResponse = {
  query: string
  document_count: number
  indexed_chunks: number
  results: RAGResult[]
}

function App() {
  const [status, setStatus] = useState('checking...')
  const [query, setQuery] = useState('What is this project about?')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [response, setResponse] = useState<RAGResponse | null>(null)

  useEffect(() => {
    const checkBackend = async () => {
      try {
        const response = await fetch('http://localhost:8000/health')
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const data = (await response.json()) as { status: string }
        setStatus(data.status)
      } catch {
        setStatus('backend not reachable')
      }
    }

    checkBackend()
  }, [])

  const runQuery = async () => {
    if (!query.trim()) {
      setError('Please enter a query.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const apiResponse = await fetch('http://localhost:8000/rag/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, k: 3, chunk_size: 300 }),
      })

      if (!apiResponse.ok) {
        throw new Error(`HTTP ${apiResponse.status}`)
      }

      const payload = (await apiResponse.json()) as RAGResponse
      setResponse(payload)
    } catch {
      setError('Query failed. Make sure backend is running on port 8000.')
      setResponse(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="app">
      <h1>DocuMind</h1>
      <p>Phase 1: End-to-end RAG skeleton</p>
      <p>
        Backend health: <strong>{status}</strong>
      </p>

      <section className="query-panel">
        <label htmlFor="query">Ask your documents</label>
        <textarea
          id="query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          rows={4}
        />
        <button type="button" onClick={runQuery} disabled={loading}>
          {loading ? 'Running...' : 'Run Phase 1 Query'}
        </button>
      </section>

      {error ? <p className="error">{error}</p> : null}

      {response ? (
        <section className="results">
          <h2>Results</h2>
          <p>
            Documents: <strong>{response.document_count}</strong> | Indexed chunks:{' '}
            <strong>{response.indexed_chunks}</strong>
          </p>
          <ul>
            {response.results.map((item) => (
              <li key={item.id}>
                <p>
                  <strong>Score:</strong> {item.score} | <strong>Source:</strong>{' '}
                  {item.source}
                </p>
                <p>{item.text}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}

export default App
