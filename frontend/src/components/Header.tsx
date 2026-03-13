import React from 'react'
import { Bot, Square, LogOut, Zap, DollarSign } from 'lucide-react'
import type { Session } from '../types'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  session: Session | null
  onStop: () => void
  onNewSession: () => void
}

const STATUS_COLORS: Record<string, string> = {
  idle: 'text-green-400',
  thinking: 'text-yellow-400',
  executing: 'text-blue-400',
  stopped: 'text-gray-400',
  error: 'text-red-400',
}

const STATUS_LABELS: Record<string, string> = {
  idle: 'Ready',
  thinking: 'Thinking…',
  executing: 'Executing…',
  stopped: 'Stopped',
  error: 'Error',
}

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-green-400',
  thinking: 'bg-yellow-400 animate-pulse',
  executing: 'bg-blue-400 animate-pulse',
  stopped: 'bg-gray-500',
  error: 'bg-red-400',
}

export default function Header({ session, onStop, onNewSession }: Props) {
  const { user, logout } = useAuth()
  const isRunning = session?.status === 'thinking' || session?.status === 'executing'

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-border bg-bg-secondary shrink-0">
      {/* Left: Brand */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-accent" />
          <span className="text-sm font-semibold text-white">Devin</span>
        </div>

        {session && (
          <>
            <span className="text-border text-gray-600">/</span>
            <span className="text-sm text-gray-400 max-w-[200px] truncate">
              {session.title}
            </span>
          </>
        )}
      </div>

      {/* Center: Status */}
      {session && (
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${STATUS_DOT[session.status] || 'bg-gray-500'}`}
          />
          <span className={`text-xs font-medium ${STATUS_COLORS[session.status] || 'text-gray-400'}`}>
            {STATUS_LABELS[session.status] || session.status}
          </span>
        </div>
      )}

      {/* Right: Cost + Controls */}
      <div className="flex items-center gap-2">
        {session && (
          <div className="flex items-center gap-1 text-xs text-gray-500 border border-border rounded-lg px-2 py-1">
            <DollarSign size={11} />
            <span>${session.cost_usd.toFixed(4)}</span>
          </div>
        )}

        {isRunning && (
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300
                       border border-red-400/30 hover:border-red-400/60 rounded-lg px-2.5 py-1
                       transition-colors"
          >
            <Square size={11} />
            Stop
          </button>
        )}

        <button onClick={onNewSession} className="btn-ghost text-xs flex items-center gap-1.5">
          <Zap size={12} />
          New Session
        </button>

        <div className="flex items-center gap-1.5 text-xs text-gray-600 pl-2 border-l border-border">
          <span className="hidden sm:block">{user?.email}</span>
          <button onClick={logout} className="btn-ghost p-1.5">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  )
}
