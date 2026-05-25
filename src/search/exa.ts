import { loadExaKey } from './keys'

export interface SearchResult {
  title: string
  url: string
  content?: string
  highlights?: string[]
}

export async function exaSearch(query: string, numResults = 5): Promise<SearchResult[]> {
  const apiKey = loadExaKey()
  if (!apiKey) throw new Error('EXA_API_KEY not configured')

  const resp = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      query,
      useAutoprompt: true,
      numResults,
      type: 'auto',
    }),
  })

  if (!resp.ok) throw new Error(`Exa API error: ${resp.status}`)

  const data = await resp.json() as Record<string, unknown>
  const results = (data.results || []) as Record<string, unknown>[]
  return results.map((r) => ({
    title: (r.title as string) || '',
    url: r.url as string,
    content: (r.text as string) || '',
    highlights: (r.highlights as string[]) || [],
  }))
}
