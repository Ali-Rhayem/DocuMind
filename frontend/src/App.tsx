import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [status, setStatus] = useState('checking...')

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

  return (
    <main className="app">
      <h1>DocuMind</h1>
      <p>Phase 1: FastAPI + React TypeScript setup</p>
      <p>
        Backend health: <strong>{status}</strong>
      </p>
    </main>
  )
}

export default App
