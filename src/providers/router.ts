import { config, type ProviderConfig } from '../config'
import { buildBaseRequest, type ProviderOptions } from './base'

export function buildProviderRequest(providerConfig: ProviderConfig, messages: unknown[], options: ProviderOptions & { extra?: Record<string, unknown> }): Record<string, unknown> {
  return {
    ...buildBaseRequest(providerConfig, messages, options),
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
