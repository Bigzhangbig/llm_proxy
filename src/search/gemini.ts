import { config } from '../config'
import type { SearchResult } from './exa'

export interface GeminiGroundingResult {
  searchResults: SearchResult[]
  groundingMetadata: {
    webSearchQueries: string[]
    groundingChunks: Array<{ web: { uri: string; title: string } }>
    groundingSupports: Array<{
      segment: { startIndex: number; endIndex: number }
      groundingChunkIndices: number[]
    }>
  }
}

export async function geminiSearch(query: string): Promise<GeminiGroundingResult> {
  if (!config.gemini.apiKey) throw new Error('GEMINI_API_KEY not configured')

  const model = config.gemini.model
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.gemini.apiKey}`

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: query }] }],
      tools: [{ googleSearch: {} }],
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Gemini API error: ${resp.status} - ${err}`)
  }

  const data = await resp.json() as Record<string, unknown>
  const candidates = data.candidates as Array<Record<string, unknown>> | undefined
  const candidate = candidates?.[0]
  const metadata = (candidate?.groundingMetadata || {}) as Record<string, unknown>

  const chunks = (metadata.groundingChunks || []) as Array<{ web?: { uri: string; title: string } }>
  const searchResults: SearchResult[] = chunks.map((c) => ({
    title: c.web?.title || '',
    url: c.web?.uri || '',
  }))

  return {
    searchResults,
    groundingMetadata: {
      webSearchQueries: (metadata.webSearchQueries as string[]) || [],
      groundingChunks: chunks.map((c) => ({
        web: { uri: c.web?.uri || '', title: c.web?.title || '' },
      })),
      groundingSupports: (metadata.groundingSupports as GeminiGroundingResult['groundingMetadata']['groundingSupports']) || [],
    },
  }
}

// Insert footnote markers into text based on groundingSupports
export function insertFootnotes(
  text: string,
  supports: Array<{ segment: { startIndex: number; endIndex: number }; groundingChunkIndices: number[] }>,
  chunks: Array<{ web: { uri: string; title: string } }>,
): string {
  if (!supports?.length || !chunks?.length) return text

  // Sort by endIndex descending to avoid index shifting
  const sorted = [...supports].sort((a, b) => (b.segment?.endIndex || 0) - (a.segment?.endIndex || 0))
  const usedIndices = new Set<number>()
  const result = [...text]

  for (const support of sorted) {
    const endIdx = support.segment?.endIndex
    if (endIdx === undefined || endIdx > result.length) continue

    const refs = (support.groundingChunkIndices || [])
      .filter((i) => !usedIndices.has(i))
      .map((i) => {
        usedIndices.add(i)
        return `[${i + 1}]`
      })

    if (refs.length > 0) {
      result.splice(endIdx, 0, ' ' + refs.join(''))
    }
  }

  return result.join('')
}
