import type { ProviderConfig } from '../config'

export interface ProviderOptions {
  stream?: boolean
  tools?: Array<Record<string, unknown>>
  tool_choice?: Record<string, unknown> | string
  temperature?: number
  max_tokens?: number
}

export interface ProviderRequestBuilder {
  (providerConfig: ProviderConfig, messages: unknown[], options: ProviderOptions): Record<string, unknown>
}

export function buildBaseRequest(providerConfig: ProviderConfig, messages: unknown[], options: ProviderOptions): Record<string, unknown> {
  return {
    model: providerConfig.model,
    messages,
    stream: options.stream ?? true,
    stream_options: options.stream ? { include_usage: true } : undefined,
    tools: options.tools,
    tool_choice: options.tool_choice,
    temperature: options.temperature,
    max_tokens: options.max_tokens,
  }
}
