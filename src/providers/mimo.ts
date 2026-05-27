import type { ProviderConfig } from '../config'
import { buildBaseRequest, type ProviderOptions } from './base'

// MiMo V2.5-Pro: auto-inject thinking mode
export function buildMiMoRequest(providerConfig: ProviderConfig, messages: unknown[], options: ProviderOptions): Record<string, unknown> {
  return {
    ...buildBaseRequest(providerConfig, messages, options),
    thinking: { type: 'enabled' },
  }
}
