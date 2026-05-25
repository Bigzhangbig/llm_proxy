import { config } from '../config'
import { exaSearch, type SearchResult } from './exa'
import { mmxSearch } from './mmx'
import { geminiSearch } from './gemini'

export type { SearchResult }

export type SearchProvider = 'exa' | 'mmx' | 'gemini'

export async function search(query: string, provider?: SearchProvider): Promise<SearchResult[]> {
  const p = provider || config.search.defaultProvider || 'exa'

  try {
    switch (p) {
      case 'exa':
        return await exaSearch(query, config.search.maxResults)
      case 'mmx':
        return await mmxSearch(query)
      case 'gemini': {
        const result = await geminiSearch(query)
        return result.searchResults
      }
      default:
        return await exaSearch(query, config.search.maxResults)
    }
  } catch (err) {
    console.error(`[Search] ${p} failed:`, err)
    // Fallback to other providers
    if (p !== 'exa') {
      try { return await exaSearch(query, config.search.maxResults) } catch { /* ignore */ }
    }
    if (p !== 'gemini') {
      try {
        const result = await geminiSearch(query)
        return result.searchResults
      } catch { /* ignore */ }
    }
    throw err
  }
}
