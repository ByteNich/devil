import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  Send,
  ChevronDown,
  ChevronRight,
  Terminal as TerminalIcon,
  FileText,
  FilePlus,
  FolderOpen,
  GitBranch,
  Globe,
  Loader2,
  Bot,
  User,
  AlertCircle,
} from 'lucide-react'
import type { UiMessage, UiToolCall, WsEvent, Session } from '../types'
import clsx from 'clsx'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000'

const TOOL_ICONS: Record<string, React.ReactNode> = {
  bash_command: <TerminalIcon size={13} className="text-tool-bash" />,
  read_file: <FileText size={13} className="text-tool-read" />,
  write_file: <FilePlus size={13} className="text-tool-write" />,
  list_directory: <FolderOpen size={13} className="text-tool-list" />,
  git_command: <GitBranch size={13} className="text-tool-git" />,
  browser_action: <Globe size={13} className="text-tool-browser" />,
}

const TOOL_COLORS: Record<string, string> = {
  bash_command: 'border-tool-bash/30 bg-tool-bash/5',
  read_file: 'border-tool-read/30 bg-tool-read/5',
  write_file: 'border-tool-write/30 bg-tool-write/5',
  list_directory: 'border-tool-list/30 bg-tool-list/5',
  git_command: 'border-tool-git/30 bg-tool-git/5',
  browser_action: 'border-tool-browser/30 bg-tool-browser/5',
}

interface Props {
  session: Session
  token: string
  onSessionUpdate: (update: Partial<Session>) => void
  onFilesChanged: () => void
}

function ToolCallBlock({ tc }: { tc: UiToolCall }) {
  const [collapsed, setCollapsed] = useState(tc.collapsed)
  const colorClass = TOOL_COLORS[tc.name] || 'border-border bg-bg-tertiary'
  const icon = TOOL_ICONS[tc.name] || <TerminalIcon size={13} />

  const inputStr = JSON.stringify(tc.input, null, 2)

  return (
    <div className={clsx('border rounded-lg text-xs font-mono overflow-hidden', colorClass)}>
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        {icon}
        <span className="font-semibold text-gray-300">{tc.name}</span>
        {!!tc.input.command && (
          <span className="text-gray-500 truncate max-w-[300px]">
            {String(tc.input.command).slice(0, 80)}
          </span>
        )}
        {!!tc.input.path && (
          <span className="text-gray-500 truncate max-w-[300px]">
            {String(tc.input.path)}
          </span>
        )}
        {!tc.result && (
          <Loader2 size={11} className="ml-auto animate-spin text-gray-500 shrink-0" />
        )}
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="border-t border-border/50">
          {/* Input */}
          <div className="px-3 py-2">
            <p className="text-gray-600 text-[10px] uppercase tracking-wide mb-1">Input</p>
            <pre className="text-gray-300 whitespace-pre-wrap break-all leading-5 max-h-48 overflow-y-auto">
              {inputStr}
            </pre>
          </div>

          {/* Result */}
          {tc.result && (
            <div className="px-3 py-2 border-t border-border/50">
              <p className="text-gray-600 text-[10px] uppercase tracking-wide mb-1">Output</p>
              <pre className="text-gray-300 whitespace-pre-wrap break-all leading-5 max-h-64 overflow-y-auto">
                {tc.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MessageBubble({ msg }: { msg: UiMessage }) {
  const isUser = msg.role === 'user'

  return (
    <div className={clsx('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={clsx(
          'w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5',
          isUser ? 'bg-accent/20 border border-accent/30' : 'bg-bg-tertiary border border-border'
        )}
      >
        {isUser ? (
          <User size={13} className="text-accent" />
        ) : (
          <Bot size={13} className="text-gray-400" />
        )}
      </div>

      {/* Content */}
      <div className={clsx('flex-1 min-w-0', isUser ? 'items-end flex flex-col' : '')}>
        {/* Text */}
        {msg.text && (
          <div
            className={clsx(
              'px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words max-w-[85%]',
              isUser
                ? 'bg-accent/20 border border-accent/30 text-gray-100'
                : 'bg-bg-tertiary border border-border text-gray-200'
            )}
          >
            {msg.text}
            {msg.streaming && !msg.toolCalls.length && (
              <span className="inline-block w-1 h-4 bg-accent ml-0.5 animate-pulse align-middle" />
            )}
          </div>
        )}

        {/* Tool calls */}
        {msg.toolCalls.length > 0 && (
          <div className="mt-2 space-y-2 w-full max-w-2xl">
            {msg.toolCalls.map((tc) => (
              <ToolCallBlock key={tc.id} tc={tc} />
            ))}
            {msg.streaming && (
              <div className="flex items-center gap-2 text-xs text-gray-600 px-1">
                <Loader2 size={11} className="animate-spin" />
                Working…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Chat({ session, token, onSessionUpdate, onFilesChanged }: Props) {
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [wsReady, setWsReady] = useState(false)
  const [wsError, setWsError] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()

  const isRunning = session.status === 'thinking' || session.status === 'executing'

  // Load history on mount / session change
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`${API_URL}/sessions/${session.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const data = await res.json()
        const uiMsgs: UiMessage[] = (data.messages || []).map((m: {
          id: string
          role: 'user' | 'assistant'
          content: string | null
          tool_calls: Array<{ tool_use_id: string; name: string; input: Record<string, unknown> }> | null
          created_at: string
        }): UiMessage => ({
          id: m.id,
          role: m.role,
          text: m.content || '',
          toolCalls: (m.tool_calls || []).map((tc) => ({
            id: tc.tool_use_id,
            name: tc.name,
            input: tc.input,
            result: undefined,
            collapsed: true,
          })),
          streaming: false,
          created_at: m.created_at,
        }))
        setMessages(uiMsgs)
      } catch {
        // ignore
      }
    }
    fetchHistory()
  }, [session.id, token])

  // WebSocket connection
  const connectWs = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    const wsUrl = `${WS_URL}/ws/${session.id}?token=${token}`
    const socket = new WebSocket(wsUrl)
    let currentAssistantId: string | null = null

    socket.onopen = () => {
      setWsReady(true)
      setWsError(false)
    }

    socket.onclose = () => {
      setWsReady(false)
      reconnectTimer.current = setTimeout(connectWs, 3000)
    }

    socket.onerror = () => {
      setWsError(true)
    }

    socket.onmessage = (e) => {
      try {
        const event: WsEvent = JSON.parse(e.data)
        handleWsEvent(event)
      } catch {
        // ignore parse errors
      }
    }

    function handleWsEvent(event: WsEvent) {
      switch (event.type) {
        case 'text_delta': {
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last && last.role === 'assistant' && last.streaming && last.id === currentAssistantId) {
              return [
                ...prev.slice(0, -1),
                { ...last, text: last.text + event.content },
              ]
            }
            // New assistant message
            const id = `streaming-${Date.now()}`
            currentAssistantId = id
            return [
              ...prev,
              {
                id,
                role: 'assistant',
                text: event.content,
                toolCalls: [],
                streaming: true,
                created_at: new Date().toISOString(),
              },
            ]
          })
          break
        }

        case 'tool_call': {
          const newTc: UiToolCall = {
            id: event.tool_use_id,
            name: event.tool_name,
            input: event.tool_input,
            result: undefined,
            collapsed: false,
          }
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last && last.role === 'assistant' && last.id === currentAssistantId) {
              return [
                ...prev.slice(0, -1),
                { ...last, toolCalls: [...last.toolCalls, newTc] },
              ]
            }
            // New assistant message with tool call
            const id = `tool-${Date.now()}`
            currentAssistantId = id
            return [
              ...prev,
              {
                id,
                role: 'assistant',
                text: '',
                toolCalls: [newTc],
                streaming: true,
                created_at: new Date().toISOString(),
              },
            ]
          })
          break
        }

        case 'tool_result': {
          setMessages((prev) => {
            return prev.map((m) => {
              if (m.role !== 'assistant') return m
              const updated = m.toolCalls.map((tc) =>
                tc.id === event.tool_use_id ? { ...tc, result: event.result } : tc
              )
              return { ...m, toolCalls: updated }
            })
          })
          onFilesChanged()
          break
        }

        case 'agent_status': {
          onSessionUpdate({ status: event.status })
          if (event.status === 'idle' || event.status === 'stopped' || event.status === 'error') {
            currentAssistantId = null
            setMessages((prev) =>
              prev.map((m) =>
                m.streaming ? { ...m, streaming: false } : m
              )
            )
          }
          break
        }

        case 'session_update': {
          onSessionUpdate({
            cost_usd: event.cost_usd,
            tokens_input: event.tokens_input,
            tokens_output: event.tokens_output,
            status: event.status,
          })
          break
        }

        case 'error': {
          setMessages((prev) => [
            ...prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
            {
              id: `err-${Date.now()}`,
              role: 'assistant',
              text: `⚠️ ${event.message}`,
              toolCalls: [],
              streaming: false,
              created_at: new Date().toISOString(),
            },
          ])
          break
        }
      }
    }

    setWs(socket)
    return socket
  }, [session.id, token, onSessionUpdate, onFilesChanged])

  useEffect(() => {
    const socket = connectWs()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      socket.close()
    }
  }, [connectWs])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = () => {
    const text = input.trim()
    if (!text || !wsReady || isRunning) return

    // Optimistic UI
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        text,
        toolCalls: [],
        streaming: false,
        created_at: new Date().toISOString(),
      },
    ])
    setInput('')

    ws?.send(JSON.stringify({ type: 'message', content: text }))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center mb-4 border border-accent/20">
              <Bot size={28} className="text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">Devin is ready</h2>
            <p className="text-gray-500 text-sm max-w-md">
              Tell me what to build. I can write code, run commands, manage files, and use git.
            </p>
            <div className="grid grid-cols-2 gap-2 mt-6 text-xs text-gray-600">
              {[
                'Create a REST API with FastAPI',
                'Set up a React project with TypeScript',
                'Write a Python web scraper',
                'Create a Docker setup for my app',
              ].map((example) => (
                <button
                  key={example}
                  onClick={() => setInput(example)}
                  className="border border-border hover:border-accent/40 rounded-lg px-3 py-2 text-left hover:text-gray-300 transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="px-4 pb-4">
        {wsError && (
          <div className="flex items-center gap-2 text-xs text-red-400 mb-2 px-1">
            <AlertCircle size={12} />
            Connection error — reconnecting…
          </div>
        )}

        <div className="border border-border rounded-2xl bg-bg-secondary focus-within:border-accent/40 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning || !wsReady}
            placeholder={
              isRunning
                ? 'Agent is working…'
                : !wsReady
                ? 'Connecting…'
                : 'Message Devin… (Enter to send, Shift+Enter for newline)'
            }
            rows={1}
            className="w-full bg-transparent px-4 pt-3 pb-2 text-sm text-gray-100
                       placeholder-gray-600 resize-none focus:outline-none
                       max-h-36 overflow-y-auto"
            style={{ minHeight: '44px' }}
            onInput={(e) => {
              const t = e.currentTarget
              t.style.height = 'auto'
              t.style.height = Math.min(t.scrollHeight, 144) + 'px'
            }}
          />

          <div className="flex items-center justify-between px-3 pb-2.5">
            <span className="text-xs text-gray-600">
              {wsReady ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                  Connected
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={10} className="animate-spin" />
                  Connecting…
                </span>
              )}
            </span>

            <button
              onClick={sendMessage}
              disabled={!input.trim() || isRunning || !wsReady}
              className="w-8 h-8 bg-accent hover:bg-accent-hover disabled:opacity-30
                         disabled:cursor-not-allowed rounded-lg flex items-center justify-center
                         transition-colors"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
