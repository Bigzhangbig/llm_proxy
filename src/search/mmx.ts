import { config } from '../config'
import type { SearchResult } from './exa'

export async function mmxSearch(query: string): Promise<SearchResult[]> {
  if (!config.mmx.apiKey) throw new Error('MMX_API_KEY not configured')

  const baseUrl = config.mmx.baseUrl
  const resp = await fetch(`${baseUrl}/v1/web_search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.mmx.apiKey}`,
    },
    body: JSON.stringify({ query }),
  })

  if (!resp.ok) throw new Error(`mmx search error: ${resp.status}`)

  const data = await resp.json() as Record<string, unknown>
  // mmx returns results in different format, normalize
  const dataObj = data.data as Record<string, unknown> | undefined
  const results = ((data.results || dataObj?.results) || []) as Record<string, unknown>[]
  return results.map((r) => ({
    title: (r.title as string) || (r.name as string) || '',
    url: (r.url as string) || (r.link as string) || '',
    content: (r.content as string) || (r.snippet as string) || '',
  }))
}
