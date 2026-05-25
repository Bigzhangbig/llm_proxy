export type SearchProvider = 'exa' | 'mmx' | 'gemini'

export const config = {
  port: Number(Bun.env.PORT || 3000),
  deepseek: {
    baseUrl: Bun.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: Bun.env.DEEPSEEK_API_KEY || '',
    model: Bun.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
  },
  exa: {
    apiKey: Bun.env.EXA_API_KEY || '',
  },
  search: {
    defaultProvider: (Bun.env.SEARCH_PROVIDER as SearchProvider) || 'exa' as SearchProvider,
    maxResults: Number(Bun.env.SEARCH_MAX_RESULTS || '5'),
  },
  debug: Bun.env.DEBUG === 'true',
}
