import { describe, it, expect, mock } from 'bun:test'

describe('search router', () => {
  it('search function exists and is callable', async () => {
    const { search } = await import('../search/router')
    expect(typeof search).toBe('function')
  })

  it('search throws when provider has no keys', async () => {
    // Mock fetch to always reject quickly
    global.fetch = mock(() => Promise.reject(new Error('network error'))) as unknown as typeof fetch

    const { search } = await import('../search/router')
    await expect(search('test query', 'gemini')).rejects.toBeInstanceOf(Error)
  })
})
