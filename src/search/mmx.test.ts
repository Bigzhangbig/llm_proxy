import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'

describe('mmx search', () => {
  let savedMmxApiKey: string | undefined

  beforeEach(() => {
    savedMmxApiKey = process.env.MMX_API_KEY
    process.env.MMX_API_KEY = 'test-key'
  })

  afterEach(() => {
    if (savedMmxApiKey !== undefined) {
      process.env.MMX_API_KEY = savedMmxApiKey
    } else {
      delete process.env.MMX_API_KEY
    }
  })

  it('returns normalized results from MiniMax search API', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify({
      organic: [
        { title: 'Example', link: 'https://example.com', snippet: 'some snippet', date: '2026-01-01' },
      ],
      base_resp: { status_code: 0, status_msg: 'success' },
    }), { status: 200 })))
    global.fetch = mockFetch as unknown as typeof fetch

    const { mmxSearch } = await import('../search/mmx')
    const results = await mmxSearch('test query')

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Example')
    expect(results[0].url).toBe('https://example.com')
    expect(results[0].content).toContain('some snippet')
    expect(results[0].content).toContain('2026-01-01')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/coding_plan/search'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': expect.stringContaining('Bearer'),
        }),
        body: JSON.stringify({ q: 'test query' }),
      }),
    )
  })

  it('throws when API returns HTTP error', async () => {
    global.fetch = mock(() => Promise.resolve(new Response('error', { status: 500 }))) as unknown as typeof fetch

    const { mmxSearch } = await import('../search/mmx')
    await expect(mmxSearch('test')).rejects.toThrow('MiniMax search error')
  })

  it('throws when base_resp.status_code is non-zero', async () => {
    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({
      organic: [],
      base_resp: { status_code: 1001, status_msg: 'invalid parameter' },
    }), { status: 200 }))) as unknown as typeof fetch

    const { mmxSearch } = await import('../search/mmx')
    await expect(mmxSearch('test')).rejects.toThrow('MiniMax search error: 1001 - invalid parameter')
  })
})
