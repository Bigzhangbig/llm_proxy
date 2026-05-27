import { type ProviderConfig } from '../config'

// MiMo V2.5-Pro: auto-inject thinking mode
export function buildMiMoRequest(providerConfig: ProviderConfig, messages: unknown[], options: {
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
    thinking: { type: 'enabled' },
  }
}
