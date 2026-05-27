import { type ProviderConfig } from '../config'

// Kimi k2.6: auto-inject thinking mode + thinking.keep for multi-turn
export function buildKimiRequest(providerConfig: ProviderConfig, messages: unknown[], options: {
  stream?: boolean
  tools?: unknown[]
  tool_choice?: unknown
  temperature?: number
  max_tokens?: number
}): Record<string, unknown> {
  return {
    model: providerConfig.model,
    messages,
    stream: options.stream ?? true,
    stream_options: options.stream ? { include_usage: true } : undefined,
    tools: options.tools,
    tool_choice: options.tool_choice,
    temperature: options.temperature,
    max_tokens: options.max_tokens,
    thinking: { type: 'enabled', keep: 'all' },
  }
}
