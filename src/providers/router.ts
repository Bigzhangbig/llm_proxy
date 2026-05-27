import { config, type ProviderConfig } from '../config'

export function buildProviderRequest(providerConfig: ProviderConfig, messages: unknown[], options: {
  stream?: boolean
  tools?: unknown[]
  tool_choice?: unknown
  temperature?: number
  max_tokens?: number
  extra?: Record<string, unknown>
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
    ...options.extra,
  }
}

export function getProviderHeaders(providerConfig: ProviderConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${providerConfig.apiKey}`,
  }
}

export function getProviderUrl(providerConfig: ProviderConfig): string {
  return `${providerConfig.baseUrl}/chat/completions`
}

export function resolveProvider(model: string): { name: string; config: ProviderConfig } {
  const modelLower = model.toLowerCase()

  if (modelLower.includes('kimi') || modelLower.startsWith('moonshot')) {
    return { name: 'kimi', config: config.providers.kimi }
  }
  if (modelLower.includes('minimax') || modelLower.startsWith('m2.')) {
    return { name: 'minimax', config: config.providers.minimax }
  }
  if (modelLower.includes('mimo')) {
    return { name: 'mimo', config: config.providers.mimo }
  }
  return { name: 'deepseek', config: config.providers.deepseek }
}
