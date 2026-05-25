export const config = {
  port: Number(Bun.env.PORT || 3000),
  deepseek: {
    baseUrl: Bun.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: Bun.env.DEEPSEEK_API_KEY || '',
    model: Bun.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
  },
  debug: Bun.env.DEBUG === 'true',
}
