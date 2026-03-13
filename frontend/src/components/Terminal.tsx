import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as TerminalIcon, Trash2 } from 'lucide-react'

interface Props {
  sessionId: string
  token: string
}

// Lightweight terminal that renders streamed bash output
// using a simple pre element (xterm.js can be wired later).
export default function Terminal({ sessionId, token }: Props) {
  const [lines, setLines] = useState<string[]>([
    '\x1b[32m$ \x1b[0mWorkspace terminal — bash output appears here',
    '',
  ])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

  const clear = () => setLines([])

  const addLine = useCallback((line: string) => {
    setLines((prev) => [...prev, line])
  }, [])

  const runCommand = async () => {
    const cmd = input.trim()
    if (!cmd || running) return
    setInput('')
    setRunning(true)

    addLine(`\x1b[32m$ \x1b[0m${cmd}`)

    try {
      const res = await fetch(`${API_URL}/sessions/${sessionId}/exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ command: cmd }),
      })
      if (!res.ok) {
        addLine(`\x1b[31m[Error ${res.status}]\x1b[0m`)
      } else {
        const data = await res.json()
        const output: string = data.output || ''
        output.split('\n').forEach((l) => addLine(l))
      }
    } catch (e: unknown) {
      addLine(`\x1b[31m[Connection error: ${e instanceof Error ? e.message : 'unknown'}]\x1b[0m`)
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  // Ansi-to-html (minimal subset)
  const renderLine = (line: string, i: number) => {
    const html = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\x1b\[0m/g, '</span>')
      .replace(/\x1b\[31m/g, '<span class="text-red-400">')
      .replace(/\x1b\[32m/g, '<span class="text-green-400">')
      .replace(/\x1b\[33m/g, '<span class="text-yellow-400">')
      .replace(/\x1b\[34m/g, '<span class="text-blue-400">')
      .replace(/\x1b\[35m/g, '<span class="text-purple-400">')
      .replace(/\x1b\[36m/g, '<span class="text-cyan-400">')
      .replace(/\x1b\[1m/g, '<span class="font-bold">')
      .replace(/\x1b\[\d+m/g, '') // strip remaining

    return (
      <div
        key={i}
        className="leading-5 min-h-[20px]"
        dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }}
      />
    )
  }

  return (
    <div className="flex flex-col h-full bg-black/40">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <TerminalIcon size={12} className="text-green-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Terminal
          </span>
        </div>
        <button onClick={clear} className="btn-ghost p-1" title="Clear">
          <Trash2 size={12} />
        </button>
      </div>

      {/* Output */}
      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-gray-300">
        {lines.map((line, i) => renderLine(line, i))}
        {running && (
          <div className="text-green-400 animate-pulse">▊</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border px-3 py-2 flex items-center gap-2 shrink-0">
        <span className="text-green-400 text-xs font-mono shrink-0">$</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runCommand()}
          disabled={running}
          placeholder="Type a command…"
          className="flex-1 bg-transparent text-xs font-mono text-gray-200
                     placeholder-gray-700 focus:outline-none"
        />
        {running && (
          <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse shrink-0" />
        )}
      </div>
    </div>
  )
}
