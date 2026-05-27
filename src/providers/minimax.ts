import type { ProviderConfig } from '../config'
import { buildBaseRequest, type ProviderOptions } from './base'

// MiniMax M2.7: auto-inject reasoning_split for structured reasoning_details
export function buildMiniMaxRequest(providerConfig: ProviderConfig, messages: unknown[], options: ProviderOptions): Record<string, unknown> {
  return {
    ...buildBaseRequest(providerConfig, messages, options),
    reasoning_split: true,
  }
}
