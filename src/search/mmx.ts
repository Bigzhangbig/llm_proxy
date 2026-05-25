import { loadMmxConfig } from './keys'
import type { SearchResult } from './exa'

interface MmxSearchResponse {
  organic?: Array<{
    title: string
    link: string
    snippet: string
    date: string
  }>
  base_resp?: { status_code: number; status_msg: string }
}

export async function mmxSearch(query: string): Promise<SearchResult[]> {
  const { apiKey, baseUrl } = loadMmxConfig()

  if (!apiKey) {
    throw new Error('MiniMax API key not found in ~/.mmx/config.json or MMX_API_KEY env')
  }

  const resp = await fetch(`${baseUrl}/v1/coding_plan/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ q: query }),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`MiniMax search error: ${resp.status} - ${errText}`)
  }

  const data = await resp.json() as MmxSearchResponse

  if (data.base_resp && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax search error: ${data.base_resp.status_code} - ${data.base_resp.status_msg}`)
  }

  const organic = data.organic || []

  return organic.map((r) => ({
    title: r.title || '',
    url: r.link || '',
    content: [r.snippet, r.date].filter(Boolean).join('\n'),
  }))
}
