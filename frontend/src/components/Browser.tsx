import React, { useState } from 'react'
import { Globe, RefreshCw, ExternalLink, ArrowLeft, ArrowRight } from 'lucide-react'

export default function Browser() {
  const [url, setUrl] = useState('')
  const [inputUrl, setInputUrl] = useState('')
  const [loading, setLoading] = useState(false)

  const navigate = (target: string) => {
    let u = target.trim()
    if (!u) return
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`
    setUrl(u)
    setLoading(true)
  }

  const handleGo = (e: React.FormEvent) => {
    e.preventDefault()
    navigate(inputUrl)
  }

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Globe size={12} className="text-purple-400 shrink-0" />
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">
          Browser
        </span>

        <div className="flex items-center gap-1 ml-2">
          <button disabled className="btn-ghost p-1 opacity-30">
            <ArrowLeft size={12} />
          </button>
          <button disabled className="btn-ghost p-1 opacity-30">
            <ArrowRight size={12} />
          </button>
          <button
            onClick={() => url && setUrl('')}
            className="btn-ghost p-1"
          >
            <RefreshCw size={12} />
          </button>
        </div>

        <form onSubmit={handleGo} className="flex-1 flex items-center gap-2">
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Enter URL…"
            className="input flex-1 text-xs py-1"
          />
          <button type="submit" className="btn-primary py-1 px-3 text-xs">
            Go
          </button>
        </form>

        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost p-1"
            title="Open in new tab"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {/* Content */}
      {!url ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
          <div className="w-14 h-14 bg-purple-400/10 rounded-2xl flex items-center justify-center mb-4 border border-purple-400/20">
            <Globe size={24} className="text-purple-400" />
          </div>
          <p className="text-gray-500 text-sm">Enter a URL to preview a webpage</p>
          <p className="text-gray-700 text-xs mt-2">
            The agent can also control the browser via the browser_action tool
          </p>
          <div className="mt-6 space-y-2">
            {['http://localhost:8000/docs', 'http://localhost:3000'].map((example) => (
              <button
                key={example}
                onClick={() => { setInputUrl(example); navigate(example) }}
                className="block w-full text-left text-xs text-purple-400/60
                           hover:text-purple-400 border border-purple-400/20
                           hover:border-purple-400/40 rounded-lg px-3 py-1.5 transition-colors"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 relative">
          <iframe
            key={url}
            src={url}
            className="w-full h-full border-0"
            title="browser"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={() => setLoading(false)}
          />
          {loading && (
            <div className="absolute inset-0 bg-bg-primary/50 flex items-center justify-center">
              <RefreshCw size={20} className="animate-spin text-purple-400" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
