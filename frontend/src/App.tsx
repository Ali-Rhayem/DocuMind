import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
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

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function getFileDownloadUrl(filename: string, pageNumber?: number): string {
  const encoded = encodeURIComponent(filename)
  const apiBaseUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : 'http://localhost:8000'
  const url = `${apiBaseUrl}/files/${encoded}`
  // Add page number if provided (PDF viewer will jump to that page)
  return pageNumber ? `${url}#page=${pageNumber}` : url
}

function resolveEvidencePage(result: RAGResult): number {
  const exactPage = result.metadata?.page_number
  if (typeof exactPage === 'number' && Number.isFinite(exactPage) && exactPage > 0) {
    return Math.floor(exactPage)
  }

  // Fallback for older indexed chunks that do not include page metadata.
  return Math.max(1, Math.floor(result.chunk_index / 3) + 1)
}

function MessageContent({ content }: { content: string }) {
  const [copiedBlockIndex, setCopiedBlockIndex] = useState<number | null>(null)

  async function copyCode(code: string, blockIndex: number) {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(code)
      } else {
        const tempTextArea = document.createElement('textarea')
        tempTextArea.value = code
        tempTextArea.style.position = 'fixed'
        tempTextArea.style.opacity = '0'
        document.body.appendChild(tempTextArea)
        tempTextArea.select()
        document.execCommand('copy')
        document.body.removeChild(tempTextArea)
      }

      setCopiedBlockIndex(blockIndex)
      window.setTimeout(() => {
        setCopiedBlockIndex((current) => (current === blockIndex ? null : current))
      }, 1400)
    } catch {
      setCopiedBlockIndex(null)
    }
  }

  const parts: Array<{ type: 'text' | 'code'; value: string; language?: string }> = []
  const codeBlockRegex = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, match.index) })
    }
    parts.push({
      type: 'code',
      language: match[1] || 'text',
      value: match[2] ?? '',
    })
    lastIndex = codeBlockRegex.lastIndex
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) })
  }

  return (
    <div className="message-content">
      {parts.map((part, partIndex) => {
        if (part.type === 'code') {
          const codeText = part.value.trimEnd()
          return (
            <div key={`code-${partIndex}`} className="message-code-block">
              <div className="message-code-head">
                <div className="message-code-language">{part.language}</div>
                <button
                  type="button"
                  className={`message-code-copy ${copiedBlockIndex === partIndex ? 'is-copied' : ''}`}
                  onClick={() => void copyCode(codeText, partIndex)}
                  title="Copy code"
                  aria-label="Copy code"
                >
                  <span className="message-code-copy__icon" aria-hidden="true" />
                  {copiedBlockIndex === partIndex ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre>
                <code>{codeText}</code>
              </pre>
            </div>
          )
        }

        const paragraphs = part.value
          .split(/\n{2,}/)
          .map((block) => block.trim())
          .filter((block) => block.length > 0)

        return (
          <Fragment key={`text-${partIndex}`}>
            {paragraphs.map((paragraph, paragraphIndex) => (
              <p key={`p-${partIndex}-${paragraphIndex}`}>{paragraph}</p>
            ))}
          </Fragment>
        )
      })}
    </div>
  )
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

function isLikelyFollowUpQuestion(question: string) {
  const normalized = question.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  const followUpPrefixes = [
    /^and\b/,
    /^what about\b/,
    /^how about\b/,
    /^what else\b/,
    /^tell me more\b/,
    /^continue\b/,
    /^go on\b/,
  ]

  if (followUpPrefixes.some((pattern) => pattern.test(normalized))) {
    return true
  }

  return /\b(it|that|this|they|them|those|these|same|above|previous|earlier)\b/.test(normalized)
}

function buildQueryFromHistory(messages: ChatMessage[], currentQuestion: string) {
  const trimmedQuestion = currentQuestion.trim()
  if (!trimmedQuestion) {
    return currentQuestion
  }

  if (!isLikelyFollowUpQuestion(trimmedQuestion)) {
    return trimmedQuestion
  }

  const recentUserQuestions = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .slice(-2)

  if (recentUserQuestions.length === 0) {
    return trimmedQuestion
  }

  return ['Previous user questions:', ...recentUserQuestions.map((message) => `- ${message}`), '', `Latest follow-up question: ${trimmedQuestion}`].join('\n')
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
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'uploading' | 'indexing' | 'done'>('idle')
  const [uploadStageText, setUploadStageText] = useState('')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readSidebarCollapsedState)
  const [deleteCandidate, setDeleteCandidate] = useState<ChatThread | null>(null)
  const [toastMessage, setToastMessage] = useState('')
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const indexingProgressTimerRef = useRef<number | null>(null)

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) ?? chats[0] ?? null,
    [chats, selectedChatId]
  )

  const documentCount = documents.length
  const selectedTotalBytes = useMemo(() => pendingFiles.reduce((sum, file) => sum + file.size, 0), [pendingFiles])

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

  useEffect(() => {
    return () => {
      if (indexingProgressTimerRef.current !== null) {
        window.clearInterval(indexingProgressTimerRef.current)
        indexingProgressTimerRef.current = null
      }
    }
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
    setPendingFiles((current) => {
      const merged: File[] = [...current]
      const seen = new Set(current.map((file) => `${file.name.toLowerCase()}::${file.size}`))

      for (const file of selected) {
        const key = `${file.name.toLowerCase()}::${file.size}`
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        merged.push(file)
      }

      return merged
    })

    setUploadNotice('')
  }

  function removePendingFile(targetKey: string) {
    setPendingFiles((current) =>
      current.filter((file) => `${file.name.toLowerCase()}::${file.size}` !== targetKey)
    )
    setUploadNotice('')
  }

  function clearPendingFiles() {
    setPendingFiles([])
    setUploadNotice('')
  }

  async function handleUploadDocuments() {
    if (pendingFiles.length === 0) {
      setUploadNotice('Choose one or more files before uploading.')
      return
    }

    setUploadLoading(true)
    setUploadPhase('uploading')
    setUploadProgress(0)
    setUploadStageText('Uploading files to backend...')
    setUploadNotice('')
    setWorkspaceNotice('')

    try {
      const uploadResult: UploadResponse = await uploadDocuments(pendingFiles, {
        onUploadProgress: (percent) => {
          setUploadPhase('uploading')
          setUploadProgress(Math.max(1, Math.min(78, Math.round(percent * 0.78))))
          setUploadStageText(`Uploading files... ${percent}%`)
        },
      })
      const rejectedCount = uploadResult.rejected.length
      const skippedCount = uploadResult.skipped.length

      if (uploadResult.uploaded_count > 0) {
        setUploadPhase('indexing')
        setUploadStageText('Indexing and chunking uploaded documents...')

        if (indexingProgressTimerRef.current !== null) {
          window.clearInterval(indexingProgressTimerRef.current)
        }

        indexingProgressTimerRef.current = window.setInterval(() => {
          setUploadProgress((current) => {
            if (current >= 96) {
              return current
            }
            return current + 1
          })
        }, 250)

        const payload: IndexRequest = {
          chunk_size: defaultQueryConfig.chunk_size,
          chunk_strategy: defaultQueryConfig.chunk_strategy,
          overlap: defaultQueryConfig.overlap,
        }
        const rebuildResult = await rebuildIndex(payload)

        if (indexingProgressTimerRef.current !== null) {
          window.clearInterval(indexingProgressTimerRef.current)
          indexingProgressTimerRef.current = null
        }

        setUploadPhase('done')
        setUploadProgress(100)
        setUploadStageText('Index complete. Ready for questions.')

        const processedDocuments = rebuildResult.processed_documents ?? 0
        const skippedDocuments = rebuildResult.skipped_documents ?? 0
        const removedChunks = rebuildResult.removed_chunks ?? 0

        setUploadNotice(
          `Uploaded ${uploadResult.uploaded_count} file(s). Indexed ${processedDocuments} changed doc(s) into ${rebuildResult.indexed_chunks} chunk(s), skipped ${skippedDocuments} unchanged doc(s), removed ${removedChunks} stale chunk(s)` +
            `${skippedCount > 0 ? `, skipped ${skippedCount} duplicate file(s)` : ''}` +
            `${rejectedCount > 0 ? `, rejected ${rejectedCount} unsupported file(s)` : ''}.`
        )
      } else {
        setUploadPhase('done')
        setUploadProgress(100)
        setUploadStageText('Upload complete. No new files were indexed.')
        setUploadNotice(
          `No new files were uploaded${skippedCount > 0 ? ` (${skippedCount} duplicate file(s) skipped)` : ''}${
            rejectedCount > 0 ? ` and ${rejectedCount} unsupported file(s) rejected` : ''
          }.`
        )
      }

      setPendingFiles([])
      await refreshWorkspace()
    } catch (error) {
      if (indexingProgressTimerRef.current !== null) {
        window.clearInterval(indexingProgressTimerRef.current)
        indexingProgressTimerRef.current = null
      }
      const message = error instanceof Error ? error.message : 'Upload failed.'
      setUploadNotice(message)
      setUploadPhase('idle')
      setUploadProgress(0)
      setUploadStageText('')
    } finally {
      setUploadLoading(false)
      window.setTimeout(() => {
        setUploadPhase('idle')
        setUploadProgress(0)
        setUploadStageText('')
      }, 1400)
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
                <input
                  type="file"
                  multiple
                  onChange={(event) => {
                    handleFilesSelected(event.target.files)
                    event.currentTarget.value = ''
                  }}
                />
                <span>{pendingFiles.length > 0 ? `${pendingFiles.length} file(s) selected` : 'Choose files'}</span>
              </label>
              <button type="button" className="button" disabled={uploadLoading} onClick={handleUploadDocuments}>
                {uploadLoading ? (uploadPhase === 'indexing' ? 'Indexing...' : 'Uploading...') : 'Upload and index'}
              </button>

              {pendingFiles.length > 0 ? (
                <div className="pending-files-panel" aria-label="Files selected for upload">
                  <div className="pending-files-panel__header">
                    <div className="pending-files-panel__summary">
                      <strong>Ready to upload</strong>
                      <span>
                        {pendingFiles.length} file(s) / {formatFileSize(selectedTotalBytes)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="pending-files-clear"
                      disabled={uploadLoading}
                      onClick={clearPendingFiles}
                    >
                      Clear all
                    </button>
                  </div>
                  <ul className="pending-files-list">
                    {pendingFiles.map((file) => {
                      const fileKey = `${file.name.toLowerCase()}::${file.size}`
                      return (
                      <li key={`${file.name}-${file.size}`}>
                        <span className="pending-files-list__name" title={file.name}>
                          {file.name}
                        </span>
                        <span className="pending-files-list__size">{formatFileSize(file.size)}</span>
                        <button
                          type="button"
                          className="pending-files-remove"
                          disabled={uploadLoading}
                          onClick={() => removePendingFile(fileKey)}
                          aria-label={`Remove ${file.name}`}
                          title={`Remove ${file.name}`}
                        >
                          Remove
                        </button>
                      </li>
                    )})}
                  </ul>
                </div>
              ) : null}

              {uploadPhase !== 'idle' ? (
                <div className="upload-progress-shell" aria-live="polite">
                  <div className="upload-progress-head">
                    <strong>{uploadPhase === 'indexing' ? 'Indexing' : uploadPhase === 'done' ? 'Complete' : 'Uploading'}</strong>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="upload-progress-track">
                    <span style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p className="upload-progress-stage">{uploadStageText}</p>
                </div>
              ) : null}

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
                        <button
                          type="button"
                          className="document-open"
                          onClick={() => window.open(getFileDownloadUrl(doc.name), '_blank')}
                          title={`Open ${doc.name}`}
                          aria-label={`Open ${doc.name}`}
                        >
                          <div className="document-item__meta">
                          <strong title={doc.name}>{doc.name}</strong>
                          <span>
                            {doc.type.toUpperCase()} / {doc.size_mb.toFixed(2)} MB /{' '}
                            {doc.indexed ? `Indexed (${doc.indexed_chunks} chunks)` : 'Not indexed'}
                          </span>
                          </div>
                        </button>
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
                    <MessageContent content={message.content} />
                    {message.role === 'assistant' && message.evidence.length > 0 ? (
                      <div className="citation-list">
                        {/* Show all evidence as clickable chips with page numbers */}
                        {message.evidence.map((item) => {
                          const filename = item.metadata.filename ?? item.source
                          const exactPage = resolveEvidencePage(item)
                          
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className="citation-chip"
                              onClick={() => window.open(getFileDownloadUrl(filename, exactPage), '_blank')}
                              title={`Click to open ${filename} at page ${exactPage}`}
                            >
                              {filename} • p.{exactPage}
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                    {message.role === 'assistant' && message.evidence.length > 0 ? (
                      <details className="evidence-details">
                        <summary>Show evidence ({message.evidence.length} sources)</summary>
                        <ul>
                          {message.evidence.map((item) => {
                            const pageNum = resolveEvidencePage(item)
                            return (
                              <li key={item.id}>
                                <div className="evidence-header">
                                  <strong>{item.metadata.filename ?? item.source}</strong>
                                  <span className="evidence-page"> • Page {pageNum}</span>
                                </div>
                                <p>{item.text}</p>
                              </li>
                            )
                          })}
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
