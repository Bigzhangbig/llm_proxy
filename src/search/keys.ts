import { config } from '../config'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// Load Exa key: config (env var) -> ~/.env
export function loadExaKey(): string {
  if (config.exa.apiKey) return config.exa.apiKey

  try {
    const homeEnv = readFileSync(join(homedir(), '.env'), 'utf-8')
    const match = homeEnv.match(/^EXA_API_KEY=(.+)$/m)
    if (match) return match[1].trim()
  } catch { /* ignore */ }

  return ''
}

// Load mmx config: config (env vars) -> ~/.mmx/config.json
export function loadMmxConfig(): { apiKey: string; region: string; baseUrl: string } {
  if (config.mmx.apiKey) {
    return {
      apiKey: config.mmx.apiKey,
      region: config.mmx.region || 'cn',
      baseUrl: config.mmx.baseUrl || 'https://api.minimaxi.com',
    }
  }

  try {
    const mmxConfigPath = join(homedir(), '.mmx', 'config.json')
    const mmxConfig = JSON.parse(readFileSync(mmxConfigPath, 'utf-8'))
    const region = mmxConfig.region || 'cn'
    const baseUrl = region === 'cn' ? 'https://api.minimaxi.com' : 'https://api.minimax.io'
    return {
      apiKey: mmxConfig.api_key || '',
      region,
      baseUrl,
    }
  } catch { /* ignore */ }

  return { apiKey: '', region: 'cn', baseUrl: 'https://api.minimaxi.com' }
}

// Load Gemini keys: env vars GOOGLE_API_KEY_1..10 -> local .env
export function loadGeminiKeys(): string[] {
  const keys: string[] = []

  // From config env vars
  for (let i = 1; i <= 10; i++) {
    const key = process.env[`GOOGLE_API_KEY_${i}`]
    if (key) keys.push(key)
  }

  // From local .env file if no keys found
  if (keys.length === 0) {
    try {
      const localEnv = readFileSync('.env', 'utf-8')
      for (let i = 1; i <= 10; i++) {
        const match = localEnv.match(new RegExp(`^GOOGLE_API_KEY_${i}=(.+)$`, 'm'))
        if (match) keys.push(match[1].trim())
      }
    } catch { /* ignore */ }
  }

  return keys
}
