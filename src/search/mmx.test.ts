import { describe, it, expect } from 'bun:test'

describe('mmx search', () => {
  it('mmxSearch throws when no API key', async () => {
    const original = process.env.MMX_API_KEY
    delete process.env.MMX_API_KEY

    const { mmxSearch } = await import('../search/mmx')
    await expect(mmxSearch('test')).rejects.toThrow()

    if (original) process.env.MMX_API_KEY = original
  })
})
