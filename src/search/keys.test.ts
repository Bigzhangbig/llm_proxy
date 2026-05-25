import { describe, it, expect } from 'bun:test'

describe('keys', () => {
  describe('loadGeminiKeys', () => {
    it('loads keys from env vars', () => {
      // Clear all GOOGLE_API_KEY_* first (Bun may load .env values)
      const saved: Record<string, string | undefined> = {}
      for (let i = 1; i <= 10; i++) {
        const k = `GOOGLE_API_KEY_${i}`
        saved[k] = process.env[k]
        delete process.env[k]
      }

      process.env.GOOGLE_API_KEY_1 = 'key1'
      process.env.GOOGLE_API_KEY_2 = 'key2'
      const { loadGeminiKeys } = require('../search/keys')
      const keys = loadGeminiKeys()
      expect(keys).toEqual(['key1', 'key2'])

      // Restore
      for (let i = 1; i <= 10; i++) {
        const k = `GOOGLE_API_KEY_${i}`
        if (saved[k] !== undefined) process.env[k] = saved[k]
        else delete process.env[k]
      }
    })

    it('returns empty array when no keys set', () => {
      const saved: Record<string, string | undefined> = {}
      for (let i = 1; i <= 10; i++) {
        const k = `GOOGLE_API_KEY_${i}`
        saved[k] = process.env[k]
        delete process.env[k]
      }

      const { loadGeminiKeys } = require('../search/keys')
      const keys = loadGeminiKeys()
      expect(Array.isArray(keys)).toBe(true)
      expect(keys.length).toBe(0)

      // Restore
      for (let i = 1; i <= 10; i++) {
        const k = `GOOGLE_API_KEY_${i}`
        if (saved[k] !== undefined) process.env[k] = saved[k]
        else delete process.env[k]
      }
    })
  })

  describe('loadMmxConfig', () => {
    it('returns config from env vars when config file absent', () => {
      const savedKey = process.env.MMX_API_KEY
      const savedRegion = process.env.MMX_REGION
      const savedHome = process.env.HOME
      process.env.HOME = '/nonexistent'
      process.env.MMX_API_KEY = 'test-key'
      process.env.MMX_REGION = 'sg'
      const { loadMmxConfig } = require('../search/keys')
      const config = loadMmxConfig()
      expect(config.apiKey).toBe('test-key')
      expect(config.baseUrl).toContain('minimax.io')
      process.env.HOME = savedHome
      if (savedKey !== undefined) process.env.MMX_API_KEY = savedKey; else delete process.env.MMX_API_KEY
      if (savedRegion !== undefined) process.env.MMX_REGION = savedRegion; else delete process.env.MMX_REGION
    })

    it('defaults to cn region', () => {
      const savedKey = process.env.MMX_API_KEY
      const savedRegion = process.env.MMX_REGION
      const savedHome = process.env.HOME
      process.env.HOME = '/nonexistent'
      delete process.env.MMX_API_KEY
      delete process.env.MMX_REGION
      const { loadMmxConfig } = require('../search/keys')
      const config = loadMmxConfig()
      expect(config.baseUrl).toContain('minimaxi.com')
      process.env.HOME = savedHome
      if (savedKey !== undefined) process.env.MMX_API_KEY = savedKey
      if (savedRegion !== undefined) process.env.MMX_REGION = savedRegion
    })
  })
})
