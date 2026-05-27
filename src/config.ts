export type SearchProvider = 'exa' | 'mmx' | 'gemini'
export type FetchProvider = 'mineru' | 'gemini' | 'cloudflare'
export type LlmProvider = 'deepseek' | 'kimi' | 'minimax' | 'mimo'

export interface ProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export const config = {
  port: Number(Bun.env.PORT || 3000),
  debug: Bun.env.DEBUG === 'true',

  providers: {
    deepseek: {
      baseUrl: Bun.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      apiKey: Bun.env.DEEPSEEK_API_KEY || '',
      model: Bun.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
    },
    kimi: {
      baseUrl: Bun.env.KIMI_BASE_URL || 'https://api.kimi.com/coding/v1',
      apiKey: Bun.env.KIMI_API_KEY || '',
      model: Bun.env.KIMI_MODEL || 'kimi-k2.6',
    },
    minimax: {
      baseUrl: Bun.env.MINIMAX_BASE_URL || 'https://api.minimax.io/v1',
      apiKey: Bun.env.MINIMAX_API_KEY || '',
      model: Bun.env.MINIMAX_MODEL || 'MiniMax-M2.7',
    },
    mimo: {
      baseUrl: Bun.env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1',
      apiKey: Bun.env.MIMO_API_KEY || '',
      model: Bun.env.MIMO_MODEL || 'mimo-v2.5-pro',
    },
  } satisfies Record<LlmProvider, ProviderConfig>,

  exa: {
    apiKey: Bun.env.EXA_API_KEY || '',
  },
  search: {
    defaultProvider: (Bun.env.SEARCH_PROVIDER as SearchProvider) || 'exa' as SearchProvider,
    maxResults: Number(Bun.env.SEARCH_MAX_RESULTS || '5'),
  },
}
