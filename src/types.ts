// Responses API request
export interface ResponsesRequest {
  model: string
  input: string | InputItem[]
  instructions?: string
  tools?: any[]
  tool_choice?: any
  stream?: boolean
  temperature?: number
  max_tokens?: number
  text?: { format?: any }
  conversation?: string
  previous_response_id?: string
}

export type InputItem =
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string }
  | { role: 'tool'; content: string; tool_call_id: string; name?: string }

export type ContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image_url'; image_url: { url: string } }

// Responses API response
export interface ResponsesResponse {
  id: string
  object: 'response'
  status: 'completed' | 'failed' | 'in_progress'
  output: OutputItem[]
  usage?: Usage
  text?: { format?: any }
  output_parsed?: any
}

export type OutputItem =
  | { type: 'message'; id: string; role: 'assistant'; content: OutputContent[]; status: string }
  | { type: 'reasoning'; id: string; summary: SummaryContent[]; status: string }

export type OutputContent = { type: 'output_text'; text: string }
export type SummaryContent = { type: 'summary_text'; text: string }

export interface Usage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  output_tokens_details?: { reasoning_tokens: number }
}

// Chat Completions request (what we send to provider)
export interface ChatCompletionRequest {
  model: string
  messages: any[]
  stream?: boolean
  tools?: any[]
  tool_choice?: any
  temperature?: number
  max_tokens?: number
  response_format?: any
  stream_options?: { include_usage: boolean }
}

// Conversation item in DB
export interface ConversationItem {
  id: string
  conversation_id: string
  role: string
  content: string | null
  reasoning_content: string | null
  reasoning_details: string | null
  tool_calls: string | null
  tool_call_id: string | null
  name: string | null
  created_at: number
}
