import React, { useEffect, useState, useCallback } from 'react'
import { Folder, FolderOpen, FileText, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react'
import type { FileNode } from '../types'
import clsx from 'clsx'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

interface Props {
  sessionId: string
  token: string
  refreshKey: number
}

interface TreeNodeProps {
  node: FileNode
  sessionId: string
  token: string
  depth: number
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const colors: Record<string, string> = {
    py: 'text-yellow-400',
    ts: 'text-blue-400',
    tsx: 'text-blue-400',
    js: 'text-yellow-300',
    jsx: 'text-yellow-300',
    json: 'text-green-400',
    md: 'text-gray-400',
    txt: 'text-gray-400',
    html: 'text-orange-400',
    css: 'text-cyan-400',
    sh: 'text-green-500',
    yml: 'text-purple-400',
    yaml: 'text-purple-400',
    toml: 'text-red-400',
    dockerfile: 'text-blue-500',
    rs: 'text-orange-500',
    go: 'text-cyan-500',
    java: 'text-red-500',
    cpp: 'text-blue-600',
    c: 'text-blue-600',
    rb: 'text-red-400',
    php: 'text-purple-500',
    sql: 'text-orange-300',
  }
  return colors[ext] || 'text-gray-500'
}

function TreeNode({ node, sessionId, token, depth }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0)
  const [children, setChildren] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)

  const loadChildren = useCallback(async () => {
    if (!node.is_dir) return
    setLoading(true)
    try {
      const res = await fetch(
        `${API_URL}/sessions/${sessionId}/files?path=${encodeURIComponent(node.path)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (res.ok) {
        setChildren(await res.json())
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [node.path, node.is_dir, sessionId, token])

  const toggle = async () => {
    if (!node.is_dir) return
    if (!expanded && children.length === 0) {
      await loadChildren()
    }
    setExpanded((p) => !p)
  }

  const indent = depth * 12

  return (
    <div>
      <div
        onClick={toggle}
        className={clsx(
          'flex items-center gap-1.5 px-2 py-0.5 text-xs rounded cursor-pointer',
          'hover:bg-white/5 transition-colors',
          node.is_dir ? 'text-gray-300' : 'text-gray-400 hover:text-gray-200'
        )}
        style={{ paddingLeft: `${8 + indent}px` }}
      >
        {node.is_dir ? (
          <>
            {expanded ? (
              <ChevronDown size={11} className="text-gray-600 shrink-0" />
            ) : (
              <ChevronRight size={11} className="text-gray-600 shrink-0" />
            )}
            {expanded ? (
              <FolderOpen size={13} className="text-yellow-500/80 shrink-0" />
            ) : (
              <Folder size={13} className="text-yellow-500/60 shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-[11px] shrink-0" />
            <FileText size={13} className={clsx('shrink-0', getFileIcon(node.name))} />
          </>
        )}
        <span className="truncate">{node.name}</span>
        {node.size !== null && !node.is_dir && (
          <span className="ml-auto text-gray-700 shrink-0">
            {node.size < 1024
              ? `${node.size}B`
              : node.size < 1024 * 1024
              ? `${(node.size / 1024).toFixed(1)}K`
              : `${(node.size / 1024 / 1024).toFixed(1)}M`}
          </span>
        )}
        {loading && <span className="text-gray-600 ml-auto">…</span>}
      </div>

      {node.is_dir && expanded && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              sessionId={sessionId}
              token={token}
              depth={depth + 1}
            />
          ))}
          {children.length === 0 && !loading && (
            <div
              className="text-gray-700 text-xs py-0.5"
              style={{ paddingLeft: `${8 + indent + 24}px` }}
            >
              empty
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function FileTree({ sessionId, token, refreshKey }: Props) {
  const [roots, setRoots] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/sessions/${sessionId}/files?path=.`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setRoots(await res.json())
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [sessionId, token])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Workspace
        </span>
        <button
          onClick={load}
          className="btn-ghost p-1"
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && roots.length === 0 ? (
          <div className="text-center text-gray-700 text-xs py-6">Loading…</div>
        ) : roots.length === 0 ? (
          <div className="text-center text-gray-700 text-xs py-8 px-4">
            <p>Workspace is empty</p>
            <p className="mt-1 text-gray-800">Files created by the agent will appear here</p>
          </div>
        ) : (
          roots.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              sessionId={sessionId}
              token={token}
              depth={0}
            />
          ))
        )}
      </div>
    </div>
  )
}
