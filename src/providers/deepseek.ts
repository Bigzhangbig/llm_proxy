import { config } from '../config'

export function buildDeepSeekRequest(messages: any[], options: {
  stream?: boolean
  tools?: any[]
  tool_choice?: any
  temperature?: number
  max_tokens?: number
  response_format?: any
}) {
  return {
    model: config.deepseek.model,
    messages,
    stream: options.stream ?? true,
    stream_options: options.stream ? { include_usage: true } : undefined,
    tools: options.tools,
    tool_choice: options.tool_choice,
    temperature: options.temperature,
    max_tokens: options.max_tokens,
    response_format: options.response_format,
  }
}

export function getDeepSeekHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.deepseek.apiKey}`,
  }
}

export function getDeepSeekUrl() {
  return `${config.deepseek.baseUrl}/chat/completions`
}
