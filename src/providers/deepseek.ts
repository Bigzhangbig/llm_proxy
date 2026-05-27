import type { ProviderConfig } from '../config'
import { buildBaseRequest, type ProviderOptions } from './base'

export function buildDeepSeekRequest(providerConfig: ProviderConfig, messages: Array<Record<string, unknown>>, options: ProviderOptions): Record<string, unknown> {
  return buildBaseRequest(providerConfig, messages, options)
}

export function getDeepSeekHeaders(providerConfig: ProviderConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${providerConfig.apiKey}`,
  }
}

export function getDeepSeekUrl(providerConfig: ProviderConfig): string {
  return `${providerConfig.baseUrl}/chat/completions`
}
