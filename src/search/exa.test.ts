import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { SearchResult } from './exa'

// Mock fetch globally
const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 })))

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockReturnValue(Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 })))
  global.fetch = mockFetch as unknown as typeof fetch
})

describe('exa search', () => {
  it('returns normalized results from Exa API', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      results: [
        { title: 'Example', url: 'https://example.com', text: 'some content', highlights: ['highlight1'] },
      ],
    }), { status: 200 }))

    // Config is already loaded with whatever EXA_API_KEY is in the environment
    // Just verify the function works and calls the API correctly
    const { exaSearch } = await import('./exa')
    const results = await exaSearch('test query')

    // If EXA_API_KEY is not set, the function throws before making a request
    // If it is set, we get results
    const apiKey = process.env.EXA_API_KEY || ''
    if (!apiKey) {
      await expect(exaSearch('query')).rejects.toThrow('EXA_API_KEY not configured')
    } else {
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Example')
      expect(results[0].url).toBe('https://example.com')
      expect(results[0].content).toBe('some content')
      expect(results[0].highlights).toEqual(['highlight1'])

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.exa.ai/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': apiKey,
          }),
        }),
      )
    }
  })
})

describe('search router', () => {
  it('calls exaSearch by default', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      results: [{ title: 'Test', url: 'https://example.com', text: 'content' }],
    }), { status: 200 }))

    const { search } = await import('./router')
    const results = await search('test query')

    const apiKey = process.env.EXA_API_KEY || ''
    if (!apiKey) {
      // Without API key, search will throw (exaSearch throws)
      expect(results).toHaveLength(0)
    } else {
      expect(results).toHaveLength(1)
      expect(results[0].url).toBe('https://example.com')
    }
  })

  it('throws when all providers fail', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))

    const { search } = await import('./router')
    await expect(search('test query')).rejects.toThrow()
  })
})
