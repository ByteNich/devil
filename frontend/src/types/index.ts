export interface User {
  id: string
  email: string
}

export interface Session {
  id: string
  title: string
  status: SessionStatus
  cost_usd: number
  tokens_input: number
  tokens_output: number
  workspace_path: string | null
  created_at: string
  updated_at: string
  messages?: ChatMessage[]
}

export type SessionStatus = 'idle' | 'thinking' | 'executing' | 'stopped' | 'error'

export interface ToolCall {
  name: string
  input: Record<string, unknown>
  tool_use_id: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string | null
  tool_calls: ToolCall[] | null
  tool_results: unknown[] | null
  created_at: string
}

// WebSocket event types from server
export type WsEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'agent_status'; status: SessionStatus }
  | { type: 'tool_call'; tool_use_id: string; tool_name: string; tool_input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; tool_name: string; result: string }
  | { type: 'token_update'; input_tokens: number; output_tokens: number; total_cost: number }
  | { type: 'session_update'; cost_usd: number; tokens_input: number; tokens_output: number; status: SessionStatus }
  | { type: 'error'; message: string }

export interface FileNode {
  name: string
  path: string
  is_dir: boolean
  size: number | null
  children?: FileNode[]
}

// Internal UI message representation
export interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  // text content
  text: string
  // streaming tool calls
  toolCalls: UiToolCall[]
  // whether this message is still streaming
  streaming: boolean
  created_at: string
}

export interface UiToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
  collapsed: boolean
}
