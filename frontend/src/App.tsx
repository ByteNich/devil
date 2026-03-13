import React, { useState, useEffect, useCallback } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Header from './components/Header'
import Chat from './components/Chat'
import FileTree from './components/FileTree'
import Terminal from './components/Terminal'
import Browser from './components/Browser'
import type { Session } from './types'
import { Plus, MessageSquare, Clock, ChevronLeft, ChevronRight, LayoutPanelLeft, Monitor } from 'lucide-react'
import clsx from 'clsx'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// ---------------------------------------------------------------------------
// Sidebar: session list
// ---------------------------------------------------------------------------
function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onCreate,
  collapsed,
  onToggle,
}: {
  sessions: Session[]
  activeId: string | null
  onSelect: (s: Session) => void
  onCreate: () => void
  collapsed: boolean
  onToggle: () => void
}) {
  const STATUS_DOT: Record<string, string> = {
    idle: 'bg-green-400',
    thinking: 'bg-yellow-400 animate-pulse',
    executing: 'bg-blue-400 animate-pulse',
    stopped: 'bg-gray-500',
    error: 'bg-red-400',
  }

  return (
    <div
      className={clsx(
        'flex flex-col border-r border-border bg-bg-secondary transition-all duration-200 shrink-0',
        collapsed ? 'w-10' : 'w-56'
      )}
    >
      {!collapsed && (
        <>
          <div className="flex items-center justify-between px-3 py-3 border-b border-border">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Sessions
            </span>
            <button onClick={onToggle} className="btn-ghost p-1">
              <ChevronLeft size={14} />
            </button>
          </div>

          <button
            onClick={onCreate}
            className="mx-2 mt-2 flex items-center gap-2 px-3 py-2 text-xs text-accent
                       border border-accent/30 hover:border-accent/60 hover:bg-accent/5
                       rounded-lg transition-colors"
          >
            <Plus size={13} />
            New Session
          </button>

          <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
            {sessions.length === 0 && (
              <p className="text-center text-gray-700 text-xs py-4">No sessions yet</p>
            )}
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelect(s)}
                className={clsx(
                  'w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors flex items-start gap-2',
                  s.id === activeId
                    ? 'bg-accent/15 border border-accent/30 text-gray-200'
                    : 'hover:bg-white/5 text-gray-400 border border-transparent'
                )}
              >
                <span
                  className={clsx('w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', STATUS_DOT[s.status] || 'bg-gray-500')}
                />
                <div className="min-w-0">
                  <p className="truncate leading-tight">{s.title}</p>
                  <p className="text-gray-700 text-[10px] mt-0.5">
                    ${s.cost_usd.toFixed(4)} · {new Date(s.created_at).toLocaleDateString()}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {collapsed && (
        <div className="flex flex-col items-center py-2 gap-1">
          <button onClick={onToggle} className="btn-ghost p-1.5">
            <ChevronRight size={14} />
          </button>
          <button onClick={onCreate} className="btn-ghost p-1.5 text-accent">
            <Plus size={14} />
          </button>
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect(s)}
              title={s.title}
              className={clsx(
                'p-1.5 rounded-lg transition-colors',
                s.id === activeId ? 'bg-accent/20 text-accent' : 'btn-ghost'
              )}
            >
              <MessageSquare size={13} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Right panel tabs: Terminal / Browser
// ---------------------------------------------------------------------------
type RightTab = 'terminal' | 'browser'

function RightPanel({
  tab,
  onTab,
  sessionId,
  token,
}: {
  tab: RightTab
  onTab: (t: RightTab) => void
  sessionId: string
  token: string
}) {
  return (
    <div className="flex flex-col h-full w-80 border-l border-border shrink-0">
      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0">
        {([['terminal', 'Terminal', <Monitor key="t" size={12} />], ['browser', 'Browser', <LayoutPanelLeft key="b" size={12} />]] as [RightTab, string, React.ReactNode][]).map(
          ([id, label, icon]) => (
            <button
              key={id}
              onClick={() => onTab(id)}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-colors border-b-2',
                tab === id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-600 hover:text-gray-400'
              )}
            >
              {icon}
              {label}
            </button>
          )
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'terminal' ? (
          <Terminal sessionId={sessionId} token={token} />
        ) : (
          <Browser />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main workspace
// ---------------------------------------------------------------------------
function Workspace() {
  const { token } = useAuth()
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [rightTab, setRightTab] = useState<RightTab>('terminal')
  const [fileRefreshKey, setFileRefreshKey] = useState(0)
  const [loadingSessions, setLoadingSessions] = useState(true)

  const fetchSessions = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_URL}/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data: Session[] = await res.json()
        setSessions(data)
        // Update active session data
        setActiveSession((prev) => {
          if (!prev) return prev
          const updated = data.find((s) => s.id === prev.id)
          return updated || prev
        })
      }
    } catch {
      // ignore
    } finally {
      setLoadingSessions(false)
    }
  }, [token])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const createSession = async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_URL}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: 'New Session' }),
      })
      if (res.ok) {
        const session: Session = await res.json()
        setSessions((prev) => [session, ...prev])
        setActiveSession(session)
      }
    } catch {
      // ignore
    }
  }

  const stopSession = async () => {
    if (!activeSession || !token) return
    try {
      await fetch(`${API_URL}/sessions/${activeSession.id}/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      updateSession({ status: 'stopped' })
    } catch {
      // ignore
    }
  }

  const updateSession = (update: Partial<Session>) => {
    setActiveSession((prev) => (prev ? { ...prev, ...update } : prev))
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSession?.id ? { ...s, ...update } : s))
    )
  }

  if (loadingSessions) {
    return (
      <div className="h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-gray-600 text-sm">Loading…</div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-bg-primary overflow-hidden">
      <Header
        session={activeSession}
        onStop={stopSession}
        onNewSession={createSession}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Session sidebar */}
        <SessionSidebar
          sessions={sessions}
          activeId={activeSession?.id || null}
          onSelect={setActiveSession}
          onCreate={createSession}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((p) => !p)}
        />

        {/* Main area */}
        {activeSession ? (
          <>
            {/* File tree */}
            <div className="w-52 border-r border-border shrink-0 overflow-hidden flex flex-col">
              <FileTree
                sessionId={activeSession.id}
                token={token!}
                refreshKey={fileRefreshKey}
              />
            </div>

            {/* Chat */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <Chat
                session={activeSession}
                token={token!}
                onSessionUpdate={updateSession}
                onFilesChanged={() => setFileRefreshKey((k) => k + 1)}
              />
            </div>

            {/* Right panel: terminal / browser */}
            <RightPanel
              tab={rightTab}
              onTab={setRightTab}
              sessionId={activeSession.id}
              token={token!}
            />
          </>
        ) : (
          /* No session selected */
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center mb-4 border border-accent/20">
              <MessageSquare size={28} className="text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">No session selected</h2>
            <p className="text-gray-500 text-sm mb-6">
              Create a new session to start working with the AI agent
            </p>
            <button onClick={createSession} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              New Session
            </button>

            {sessions.length > 0 && (
              <div className="mt-8">
                <p className="text-gray-600 text-xs mb-3 uppercase tracking-wide">
                  Recent sessions
                </p>
                <div className="space-y-2">
                  {sessions.slice(0, 5).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setActiveSession(s)}
                      className="flex items-center gap-3 px-4 py-2.5 border border-border
                                 rounded-xl hover:border-accent/40 hover:bg-accent/5 transition-colors
                                 text-left w-64"
                    >
                      <Clock size={13} className="text-gray-600 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm text-gray-300 truncate">{s.title}</p>
                        <p className="text-xs text-gray-600">
                          {new Date(s.created_at).toLocaleString()}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Protected route
// ---------------------------------------------------------------------------
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-gray-600 text-sm">Loading…</div>
      </div>
    )
  }
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Workspace />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  )
}
