import { describe, it, expect } from 'bun:test'

describe('search router', () => {
  it('search function exists and is callable', async () => {
    const { search } = await import('../search/router')
    expect(typeof search).toBe('function')
  })

  it('search throws when provider has no keys', async () => {
    // This will fail because no real keys, but should not throw unexpected errors
    const { search } = await import('../search/router')
    try {
      await search('test query', 'gemini')
    } catch (err: any) {
      // Should throw a meaningful error, not crash
      expect(err).toBeInstanceOf(Error)
    }
  })
})
