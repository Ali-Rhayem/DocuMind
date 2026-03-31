import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  deleteDocument,
  getHealth,
  getIngestionPreview,
  getIndexStats,
  rebuildIndex,
  runQuery,
  uploadDocuments,
} from './lib/api.ts'
import type {
  DocumentPreview,
  IndexRequest,
  IndexStatsResponse,
  QueryRequest,
  RAGResult,
  UploadResponse,
} from './types/api.ts'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  citations: string[]
  evidence: RAGResult[]
}

type ChatThread = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
}

type PersistedChatState = {
  chats: ChatThread[]
  selectedChatId: string
}

const CHAT_STORAGE_KEY = 'documind.chat.workspace.v1'
const SIDEBAR_STORAGE_KEY = 'documind.chat.sidebar.collapsed.v1'

const defaultQueryConfig: Omit<QueryRequest, 'query'> = {
  k: 4,
  chunk_size: 500,
  chunk_strategy: 'semantic',
  overlap: 100,
  build_if_empty: false,
}

const quickPrompts = [
  'Summarize the uploaded document.',
  'What are the most important points?',
  'Give me action items based on this document.',
]

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function makeChatTitle(seed: string) {
  const compact = seed.trim().replace(/\s+/g, ' ')
  if (!compact) {
    return 'New chat'
  }
  return compact.length > 42 ? `${compact.slice(0, 39)}...` : compact
}

function createThread(): ChatThread {
  const now = new Date().toISOString()
  return {
    id: createId(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

function readPersistedState(): PersistedChatState {
  const fallbackThread = createThread()
  const fallback: PersistedChatState = {
    chats: [fallbackThread],
    selectedChatId: fallbackThread.id,
  }

  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY)
    if (!raw) {
      return fallback
    }

    const parsed = JSON.parse(raw) as Partial<PersistedChatState>
    if (!Array.isArray(parsed.chats) || parsed.chats.length === 0) {
      return fallback
    }

    const firstId = typeof parsed.chats[0]?.id === 'string' ? parsed.chats[0].id : fallback.selectedChatId
    const selected =
      typeof parsed.selectedChatId === 'string' && parsed.chats.some((chat) => chat.id === parsed.selectedChatId)
        ? parsed.selectedChatId
        : firstId

    return {
      chats: parsed.chats,
      selectedChatId: selected,
    }
  } catch {
    return fallback
  }
}

function readSidebarCollapsedState() {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function buildQueryFromHistory(messages: ChatMessage[], currentQuestion: string) {
  const history = messages
    .slice(-6)
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n')
    .trim()

  if (!history) {
    return currentQuestion
  }

  return `Conversation so far:\n${history}\n\nLatest user question: ${currentQuestion}`
}

function App() {
  const persisted = readPersistedState()

  const [backendStatus, setBackendStatus] = useState('checking')
  const [indexStats, setIndexStats] = useState<IndexStatsResponse | null>(null)
  const [documents, setDocuments] = useState<DocumentPreview[]>([])
  const [workspaceNotice, setWorkspaceNotice] = useState('')
  const [uploadNotice, setUploadNotice] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [deletingFileName, setDeletingFileName] = useState('')
  const [chats, setChats] = useState<ChatThread[]>(persisted.chats)
  const [selectedChatId, setSelectedChatId] = useState(persisted.selectedChatId)
  const [messageInput, setMessageInput] = useState('')
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [activeGenerationChatId, setActiveGenerationChatId] = useState<string | null>(null)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readSidebarCollapsedState)
  const [deleteCandidate, setDeleteCandidate] = useState<ChatThread | null>(null)
  const [toastMessage, setToastMessage] = useState('')
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) ?? chats[0] ?? null,
    [chats, selectedChatId]
  )

  const documentCount = documents.length

  useEffect(() => {
    const payload: PersistedChatState = {
      chats,
      selectedChatId,
    }
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(payload))
  }, [chats, selectedChatId])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, isSidebarCollapsed ? '1' : '0')
  }, [isSidebarCollapsed])

  useEffect(() => {
    timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight, behavior: 'smooth' })
  }, [selectedChat?.messages.length])

  useEffect(() => {
    void refreshWorkspace()
  }, [])

  async function refreshWorkspace() {
    setLoadingWorkspace(true)
    setWorkspaceNotice('')

    const [healthResult, statsResult, previewResult] = await Promise.allSettled([
      getHealth(),
      getIndexStats(),
      getIngestionPreview(),
    ])

    if (healthResult.status === 'fulfilled') {
      setBackendStatus(healthResult.value.status)
    } else {
      setBackendStatus('offline')
      setWorkspaceNotice(healthResult.reason instanceof Error ? healthResult.reason.message : 'Backend unavailable.')
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

    if (statsResult.status === 'rejected' || previewResult.status === 'rejected') {
      setWorkspaceNotice((current) => current || 'Some workspace data is temporarily unavailable.')
    }

    setLoadingWorkspace(false)
  }

  function createChat() {
    const nextChat = createThread()
    setChats((current) => [nextChat, ...current])
    setSelectedChatId(nextChat.id)
    setMessageInput('')
  }

  function deleteChat(chatId: string) {
    setChats((current) => {
      const next = current.filter((chat) => chat.id !== chatId)
      if (next.length > 0) {
        if (chatId === selectedChatId) {
          setSelectedChatId(next[0].id)
        }
        return next
      }

      const fallback = createThread()
      setSelectedChatId(fallback.id)
      return [fallback]
    })
  }

  function showToast(message: string, timeoutMs = 2500) {
    setToastMessage(message)
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage('')
      toastTimerRef.current = null
    }, timeoutMs)
  }

  function requestDeleteChat(chat: ChatThread) {
    setDeleteCandidate(chat)
  }

  function cancelDeleteChat() {
    setDeleteCandidate(null)
  }

  function confirmDeleteChat() {
    if (!deleteCandidate) {
      return
    }
    deleteChat(deleteCandidate.id)
    setDeleteCandidate(null)
    showToast('Chat deleted.')
  }

  async function handleSendMessage() {
    const question = messageInput.trim()
    if (!question || !selectedChat) {
      return
    }

    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: question,
      createdAt: new Date().toISOString(),
      citations: [],
      evidence: [],
    }

    setMessageInput('')
    setSendingMessage(true)
    setActiveGenerationChatId(selectedChat.id)
    setWorkspaceNotice('')

    setChats((current) =>
      current.map((chat) => {
        if (chat.id !== selectedChat.id) {
          return chat
        }
        const nextMessages = [...chat.messages, userMessage]
        return {
          ...chat,
          title: chat.messages.length === 0 ? makeChatTitle(question) : chat.title,
          updatedAt: new Date().toISOString(),
          messages: nextMessages,
        }
      })
    )

    try {
      const query: QueryRequest = {
        ...defaultQueryConfig,
        query: buildQueryFromHistory(selectedChat.messages, question),
      }
      const payload = await runQuery(query)

      const assistantMessage: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: payload.answer.text,
        createdAt: new Date().toISOString(),
        citations: payload.answer.citations,
        evidence: payload.results,
      }

      setChats((current) =>
        current.map((chat) => {
          if (chat.id !== selectedChat.id) {
            return chat
          }

          return {
            ...chat,
            updatedAt: new Date().toISOString(),
            messages: [...chat.messages, assistantMessage],
          }
        })
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Query failed.'
      setWorkspaceNotice(message)

      setChats((current) =>
        current.map((chat) => {
          if (chat.id !== selectedChat.id) {
            return chat
          }

          const errorMessage: ChatMessage = {
            id: createId(),
            role: 'assistant',
            content: `I could not answer this yet. ${message}`,
            createdAt: new Date().toISOString(),
            citations: [],
            evidence: [],
          }

          return {
            ...chat,
            updatedAt: new Date().toISOString(),
            messages: [...chat.messages, errorMessage],
          }
        })
      )
    } finally {
      setSendingMessage(false)
      setActiveGenerationChatId(null)
    }
  }

  function handleFilesSelected(files: FileList | null) {
    if (!files) {
      setPendingFiles([])
      setUploadNotice('')
      return
    }

    const selected = Array.from(files)
    const deduped: File[] = []
    const seen = new Set<string>()
    for (const file of selected) {
      const key = `${file.name.toLowerCase()}::${file.size}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      deduped.push(file)
    }

    setPendingFiles(deduped)
    setUploadNotice('')
  }

  async function handleUploadDocuments() {
    if (pendingFiles.length === 0) {
      setUploadNotice('Choose one or more files before uploading.')
      return
    }

    setUploadLoading(true)
    setUploadNotice('')
    setWorkspaceNotice('')

    try {
      const uploadResult: UploadResponse = await uploadDocuments(pendingFiles)
      const rejectedCount = uploadResult.rejected.length
      const skippedCount = uploadResult.skipped.length

      if (uploadResult.uploaded_count > 0) {
        const payload: IndexRequest = {
          chunk_size: defaultQueryConfig.chunk_size,
          chunk_strategy: defaultQueryConfig.chunk_strategy,
          overlap: defaultQueryConfig.overlap,
        }
        const rebuildResult = await rebuildIndex(payload)
        const processedDocuments = rebuildResult.processed_documents ?? 0
        const skippedDocuments = rebuildResult.skipped_documents ?? 0
        const removedChunks = rebuildResult.removed_chunks ?? 0

        setUploadNotice(
          `Uploaded ${uploadResult.uploaded_count} file(s). Indexed ${processedDocuments} changed doc(s) into ${rebuildResult.indexed_chunks} chunk(s), skipped ${skippedDocuments} unchanged doc(s), removed ${removedChunks} stale chunk(s)` +
            `${skippedCount > 0 ? `, skipped ${skippedCount} duplicate file(s)` : ''}` +
            `${rejectedCount > 0 ? `, rejected ${rejectedCount} unsupported file(s)` : ''}.`
        )
      } else {
        setUploadNotice(
          `No new files were uploaded${skippedCount > 0 ? ` (${skippedCount} duplicate file(s) skipped)` : ''}${
            rejectedCount > 0 ? ` and ${rejectedCount} unsupported file(s) rejected` : ''
          }.`
        )
      }

      setPendingFiles([])
      await refreshWorkspace()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed.'
      setUploadNotice(message)
    } finally {
      setUploadLoading(false)
    }
  }

  async function handleDeleteDocument(fileName: string) {
    setDeletingFileName(fileName)
    setWorkspaceNotice('')
    setUploadNotice('')

    try {
      const result = await deleteDocument(fileName)
      setUploadNotice(`Deleted ${result.deleted_file} and removed ${result.removed_chunks} indexed chunk(s).`)
      await refreshWorkspace()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed.'
      setWorkspaceNotice(message)
    } finally {
      setDeletingFileName('')
    }
  }

  return (
    <main className={`chat-layout ${isSidebarCollapsed ? 'chat-layout--collapsed' : ''}`}>
      <aside className={`chat-sidebar ${isSidebarCollapsed ? 'chat-sidebar--collapsed' : ''}`}>
        {isSidebarCollapsed ? (
          <div className="sidebar-mini">
            <button
              type="button"
              className="button button--icon"
              onClick={() => setIsSidebarCollapsed(false)}
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              {'>'}
            </button>
            <button
              type="button"
              className="sidebar-nav-item sidebar-nav-item--mini"
              onClick={createChat}
              aria-label="New chat"
              title="New chat"
            >
              <span className="sidebar-nav-item__icon">+</span>
              <span>New chat</span>
            </button>

            <div className="sidebar-mini-threads" aria-label="Chats">
              {chats.map((chat) => (
                <div key={chat.id} className={`mini-thread-row ${chat.id === selectedChatId ? 'mini-thread-row--active' : ''}`}>
                  <button
                    type="button"
                    className={`mini-thread ${chat.id === selectedChatId ? 'mini-thread--active' : ''}`}
                    onClick={() => setSelectedChatId(chat.id)}
                    title={`${chat.title} (${chat.messages.length} messages)`}
                  >
                    <span className="mini-thread__title">{chat.title}</span>
                    <span className="mini-thread__count">{chat.messages.length}</span>
                  </button>
                  <button
                    type="button"
                    className="thread-delete thread-delete--mini"
                    onClick={() => requestDeleteChat(chat)}
                    aria-label={`Delete ${chat.title}`}
                    title={`Delete ${chat.title}`}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>

            <div className="sidebar-mini-stats" aria-hidden="true">
              <span title="Documents">{documentCount}</span>
              <span title="Indexed chunks">{indexStats?.indexed_chunks ?? 0}</span>
            </div>
          </div>
        ) : (
          <div className="sidebar-expanded">
            <div className="sidebar-header">
              <h1>DocuMind</h1>
              <div className="sidebar-header-actions">
                <button
                  type="button"
                  className="button button--icon"
                  onClick={() => setIsSidebarCollapsed(true)}
                  aria-label="Collapse sidebar"
                  title="Collapse sidebar"
                >
                  {'<'}
                </button>
              </div>
            </div>

            <div className="sidebar-nav" aria-label="Primary sidebar actions">
              <button type="button" className="sidebar-nav-item" onClick={createChat}>
                <span className="sidebar-nav-item__icon">+</span>
                <span>New chat</span>
              </button>
            </div>

            <p className="sidebar-status">
              Backend: <strong>{backendStatus}</strong> / Documents: <strong>{documentCount}</strong> / Indexed chunks:{' '}
              <strong>{indexStats?.indexed_chunks ?? 0}</strong>
            </p>

            <div className="upload-panel">
              <label className="file-picker">
                <input type="file" multiple onChange={(event) => handleFilesSelected(event.target.files)} />
                <span>{pendingFiles.length > 0 ? `${pendingFiles.length} file(s) selected` : 'Choose files'}</span>
              </label>
              <button type="button" className="button" disabled={uploadLoading} onClick={handleUploadDocuments}>
                {uploadLoading ? 'Uploading...' : 'Upload and index'}
              </button>
              {uploadNotice ? <p className="notice notice--success">{uploadNotice}</p> : null}
            </div>

            <div className="sidebar-scroll">
              <div className="documents-panel" aria-label="Uploaded documents">
                <div className="documents-panel__header">
                  <h3>Uploaded files</h3>
                  <span>{documents.length}</span>
                </div>

                {documents.length > 0 ? (
                  <div className="documents-list">
                    {documents.map((doc) => (
                      <article key={doc.name} className="document-item">
                        <div className="document-item__meta">
                          <strong title={doc.name}>{doc.name}</strong>
                          <span>
                            {doc.type.toUpperCase()} / {doc.size_mb.toFixed(2)} MB /{' '}
                            {doc.indexed ? `Indexed (${doc.indexed_chunks} chunks)` : 'Not indexed'}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="document-delete"
                          disabled={deletingFileName === doc.name}
                          onClick={() => handleDeleteDocument(doc.name)}
                          aria-label={`Delete ${doc.name}`}
                        >
                          {deletingFileName === doc.name ? '...' : 'Delete'}
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="documents-empty">No uploaded files yet.</p>
                )}
              </div>

              <div className="thread-list" aria-label="Chat threads">
                {chats.map((chat) => (
                  <div key={chat.id} className={`thread-item ${chat.id === selectedChatId ? 'thread-item--active' : ''}`}>
                    <button type="button" onClick={() => setSelectedChatId(chat.id)}>
                      <strong>{chat.title}</strong>
                      <span>{chat.messages.length} message(s)</span>
                    </button>
                    <button
                      type="button"
                      className="thread-delete"
                      onClick={() => requestDeleteChat(chat)}
                      aria-label={`Delete ${chat.title}`}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </aside>

      <section className="chat-main">
        <header className="chat-header">
          <h2>{selectedChat?.title ?? 'Chat'}</h2>
          <div className="chat-header-actions">
            {isSidebarCollapsed ? (
              <button type="button" className="button" onClick={() => setIsSidebarCollapsed(false)}>
                Show sidebar
              </button>
            ) : null}
            <button type="button" className="button" disabled={loadingWorkspace} onClick={refreshWorkspace}>
              {loadingWorkspace ? 'Refreshing...' : 'Refresh workspace'}
            </button>
          </div>
        </header>

        {workspaceNotice ? <p className="notice notice--error">{workspaceNotice}</p> : null}

        <div className="quick-prompt-row">
          {quickPrompts.map((prompt) => (
            <button key={prompt} type="button" className="prompt-chip" onClick={() => setMessageInput(prompt)}>
              {prompt}
            </button>
          ))}
        </div>

        <div className="timeline" ref={timelineRef}>
          <div className="timeline-track">
            {selectedChat?.messages.length ? (
              <>
                {selectedChat.messages.map((message) => (
                  <article key={message.id} className={`message message--${message.role}`}>
                    <p>{message.content}</p>
                    {message.citations.length > 0 ? (
                      <div className="citation-list">
                        {message.citations.map((citation) => (
                          <span key={citation}>{citation}</span>
                        ))}
                      </div>
                    ) : null}
                    {message.role === 'assistant' && message.evidence.length > 0 ? (
                      <details className="evidence-details">
                        <summary>Show evidence</summary>
                        <ul>
                          {message.evidence.slice(0, 4).map((item) => (
                            <li key={item.id}>
                              <strong>{item.metadata.filename ?? item.source}</strong>
                              <p>{item.text}</p>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </article>
                ))}

                {sendingMessage && activeGenerationChatId === selectedChatId ? (
                  <article className="message message--assistant message--skeleton" aria-live="polite" aria-label="Generating response">
                    <div className="skeleton-line"></div>
                    <div className="skeleton-line skeleton-line--short"></div>
                    <div className="skeleton-line skeleton-line--tiny"></div>
                  </article>
                ) : null}
              </>
            ) : (
              <div className="empty-state">
                <h3>Start your first question</h3>
                <p>Upload a document, then ask questions naturally. Your conversation history is saved per chat.</p>
              </div>
            )}
          </div>
        </div>

        <footer className="composer">
          <textarea
            value={messageInput}
            onChange={(event) => {
              setMessageInput(event.target.value)
              const textarea = event.target as HTMLTextAreaElement
              textarea.style.height = 'auto'
              const scrollHeight = Math.min(textarea.scrollHeight, 280)
              textarea.style.height = scrollHeight + 'px'
            }}
            placeholder="Ask anything about your uploaded documents..."
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSendMessage()
              }
            }}
          />
          <button
            type="button"
            className={`button button--solid ${sendingMessage ? 'is-loading composer-send--loading' : ''}`}
            disabled={sendingMessage}
            onClick={handleSendMessage}
            aria-label={sendingMessage ? 'Generating response' : 'Send message'}
          >
            {sendingMessage ? <span className="composer-spinner" aria-hidden="true"></span> : null}
          </button>
        </footer>

        <div className="toast-stack" aria-live="polite" aria-atomic="true">
          {deleteCandidate ? (
            <div className="toast toast--confirm" role="status">
              <p>Delete chat "{deleteCandidate.title}"?</p>
              <div className="toast-actions">
                <button type="button" className="button" onClick={cancelDeleteChat}>
                  Cancel
                </button>
                <button type="button" className="button button--solid" onClick={confirmDeleteChat}>
                  Delete
                </button>
              </div>
            </div>
          ) : null}

          {toastMessage ? (
            <div className="toast" role="status">
              <p>{toastMessage}</p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}

export default App
