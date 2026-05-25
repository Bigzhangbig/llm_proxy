export function loadExaKey(): string {
  return Bun.env.EXA_API_KEY || ''
}

export function loadMmxConfig() {
  return {
    apiKey: Bun.env.MMX_API_KEY || '',
    region: Bun.env.MMX_REGION || 'cn',
    baseUrl: Bun.env.MMX_BASE_URL || (Bun.env.MMX_REGION === 'sg' ? 'https://api.minimax.io' : 'https://api.minimaxi.com'),
  }
}

export function loadGeminiKeys(): string[] {
  const keys: string[] = []
  for (let i = 1; i <= 10; i++) {
    const key = Bun.env[`GOOGLE_API_KEY_${i}`]
    if (key) keys.push(key)
  }
  return keys
}
