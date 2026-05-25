import { loadMmxConfig } from './keys'
import type { SearchResult } from './exa'

interface MmxChatResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

export async function mmxSearch(query: string): Promise<SearchResult[]> {
  const { apiKey, baseUrl } = loadMmxConfig()

  if (!apiKey) {
    throw new Error('mmx API key not found in ~/.mmx/config.json or environment')
  }

  // mmx web search uses chat completions with web_search tool
  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-M2.7',
      messages: [{ role: 'user', content: query }],
      tools: [{ type: 'web_search' }],
      stream: false,
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`mmx API error: ${resp.status} - ${errText}`)
  }

  const data = await resp.json() as MmxChatResponse
  const message = data.choices?.[0]?.message?.content || ''

  // Parse search results from the response
  const results: SearchResult[] = []

  // Try to extract URLs from the response
  const urlRegex = /https?:\/\/[^\s)]+/g
  const urls = message.match(urlRegex) || []

  for (const url of urls) {
    results.push({
      title: '',
      url,
      content: '',
    })
  }

  // If no URLs found, return the message as a single result
  if (results.length === 0 && message) {
    results.push({
      title: 'mmx search result',
      url: '',
      content: message,
    })
  }

  return results
}
