import type { ProviderConfig } from '../config'
import { buildBaseRequest, type ProviderOptions } from './base'

// Kimi k2.6: auto-inject thinking mode + thinking.keep for multi-turn
export function buildKimiRequest(providerConfig: ProviderConfig, messages: unknown[], options: ProviderOptions): Record<string, unknown> {
  return {
    ...buildBaseRequest(providerConfig, messages, options),
    thinking: { type: 'enabled', keep: 'all' },
  }
}
