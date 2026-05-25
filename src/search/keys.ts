import { readFileSync } from 'fs'

export function loadExaKey(): string {
  return Bun.env.EXA_API_KEY || ''
}

export function loadMmxConfig(): { apiKey: string; baseUrl: string } {
  // Try ~/.mmx/config.json first
  try {
    const home = Bun.env.HOME
    if (!home) throw new Error('HOME not set')
    const configPath = `${home}/.mmx/config.json`
    const text = readFileSync(configPath, 'utf8')
    const config = JSON.parse(text) as Record<string, unknown>
    const region = typeof config.region === 'string' ? config.region : 'cn'
    const baseUrl = region === 'sg' ? 'https://api.minimax.io' : 'https://api.minimaxi.com'
    const apiKey = typeof config.api_key === 'string' ? config.api_key : ''
    return { apiKey, baseUrl }
  } catch { /* ignore */ }

  // Fallback to env vars
  const region = Bun.env.MMX_REGION || 'cn'
  return {
    apiKey: Bun.env.MMX_API_KEY || '',
    baseUrl: Bun.env.MMX_BASE_URL || (region === 'sg' ? 'https://api.minimax.io' : 'https://api.minimaxi.com'),
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
