import { describe, it, expect, mock, beforeEach } from 'bun:test'

// Mock fetch globally
const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 })))

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockReturnValue(Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 })))
  global.fetch = mockFetch as unknown as typeof fetch
  // Ensure EXA_API_KEY is set for tests
  process.env.EXA_API_KEY = process.env.EXA_API_KEY || 'test-key-for-ci'
})

describe('exa search', () => {
  it('returns normalized results from Exa API', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      results: [
        { title: 'Example', url: 'https://example.com', text: 'some content', highlights: ['highlight1'] },
      ],
    }), { status: 200 }))

    const { exaSearch } = await import('./exa')
    const results = await exaSearch('test query')

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
          'x-api-key': process.env.EXA_API_KEY,
        }),
      }),
    )
  })

  it('throws on API error', async () => {
    mockFetch.mockResolvedValueOnce(new Response('error', { status: 500 }))
    const { exaSearch } = await import('./exa')
    await expect(exaSearch('test')).rejects.toThrow('Exa API error')
  })
})
