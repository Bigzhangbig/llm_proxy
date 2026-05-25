import { loadGeminiKeys } from './keys'
import type { SearchResult } from './exa'

// Models in priority order
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemma-4-26b-a4b-it',
  'gemma-4-31b-it',
]

interface KeyEntry {
  key: string
  lastError: number
  errorCount: number
}

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

class GeminiKeyPool {
  private keys: KeyEntry[] = []
  private currentIndex = 0
  private modelIndex = 0

  constructor(keys: string[]) {
    this.keys = keys.map((key) => ({
      key,
      lastError: 0,
      errorCount: 0,
    }))
  }

  // Get next available key (round-robin, skip recently errored)
  getKey(): string | null {
    if (this.keys.length === 0) return null
    const now = Date.now()

    // Find a key that's not in cooldown (10s cooldown after error)
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length
      const entry = this.keys[idx]
      if (now - entry.lastError > 10_000) {
        this.currentIndex = (idx + 1) % this.keys.length
        return entry.key
      }
    }

    // All keys in cooldown, pick the one with oldest error
    this.keys.sort((a, b) => a.lastError - b.lastError)
    this.currentIndex = 1 % this.keys.length
    return this.keys[0].key
  }

  // Get current model
  getModel(): string {
    return GEMINI_MODELS[this.modelIndex % GEMINI_MODELS.length]
  }

  // Mark key error (429)
  markError(key: string): void {
    const entry = this.keys.find((k) => k.key === key)
    if (entry) {
      entry.lastError = Date.now()
      entry.errorCount++
    }
  }

  // Mark success - reset error count
  markSuccess(key: string): void {
    const entry = this.keys.find((k) => k.key === key)
    if (entry) {
      entry.errorCount = 0
    }
  }

  // Switch to next model
  nextModel(): string {
    this.modelIndex = (this.modelIndex + 1) % GEMINI_MODELS.length
    return this.getModel()
  }

  get keyCount(): number {
    return this.keys.length
  }
}

let pool: GeminiKeyPool | null = null

function getPool(): GeminiKeyPool {
  if (!pool) {
    const keys = loadGeminiKeys()
    pool = new GeminiKeyPool(keys)
    if (keys.length > 0) {
      console.log(`[Gemini] Loaded ${keys.length} API keys, ${GEMINI_MODELS.length} models`)
    } else {
      console.warn('[Gemini] No API keys found')
    }
  }
  return pool
}

export async function geminiSearch(query: string): Promise<GeminiGroundingResult> {
  const p = getPool()

  if (p.keyCount === 0) {
    throw new Error('No Gemini API keys configured')
  }

  let lastError: Error | null = null
  const maxAttempts = p.keyCount * 2

  // Try each key once, with model fallback on 429
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = p.getKey()
    if (!key) break

    const model = p.getModel()
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: query }] }],
          tools: [{ googleSearch: {} }],
        }),
      })

      if (resp.status === 429) {
        console.warn(`[Gemini] 429 on key ...${key.slice(-6)} model=${model}`)
        p.markError(key)
        // After retrying the same key, switch model
        if (attempt % 2 === 1) {
          const newModel = p.nextModel()
          console.log(`[Gemini] Switching to model ${newModel}`)
        }
        continue
      }

      if (!resp.ok) {
        const errText = await resp.text()
        throw new Error(`Gemini API error: ${resp.status} - ${errText}`)
      }

      p.markSuccess(key)
      const data = await resp.json() as Record<string, unknown>
      return parseGeminiResponse(data)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('429')) {
        lastError = err instanceof Error ? err : new Error(msg)
        continue
      }
      throw err
    }
  }

  throw lastError || new Error('All Gemini keys exhausted')
}

function parseGeminiResponse(data: Record<string, unknown>): GeminiGroundingResult {
  const candidates = data.candidates as Array<Record<string, unknown>> | undefined
  const candidate = candidates?.[0]
  const metadata = (candidate?.groundingMetadata || {}) as Record<string, unknown>
  const chunks = (metadata.groundingChunks || []) as Array<{ web?: { uri: string; title: string } }>
  const supports = (metadata.groundingSupports || []) as Array<{
    segment?: { text?: string }
    groundingChunkIndices?: number[]
  }>

  // Aggregate grounding segment texts by chunk index
  const chunkTexts: string[][] = chunks.map(() => [])
  for (const support of supports) {
    const text = support.segment?.text
    const indices = support.groundingChunkIndices || []
    if (!text) continue
    for (const idx of indices) {
      if (idx >= 0 && idx < chunks.length) {
        chunkTexts[idx].push(text)
      }
    }
  }

  const searchResults: SearchResult[] = chunks.map((c, i) => ({
    title: c.web?.title || '',
    url: c.web?.uri || '',
    content: chunkTexts[i].join('\n'),
  }))

  return {
    searchResults,
    groundingMetadata: {
      webSearchQueries: (metadata.webSearchQueries as string[]) || [],
      groundingChunks: chunks.map((c) => ({
        web: { uri: c.web?.uri || '', title: c.web?.title || '' },
      })),
      groundingSupports:
        (metadata.groundingSupports as GeminiGroundingResult['groundingMetadata']['groundingSupports']) || [],
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
  const chars = [...text]

  for (const support of sorted) {
    const endIdx = support.segment?.endIndex
    if (endIdx === undefined || endIdx > chars.length) continue

    const refs = (support.groundingChunkIndices || [])
      .filter((i: number) => !usedIndices.has(i))
      .map((i: number) => {
        usedIndices.add(i)
        return `[${i + 1}]`
      })

    if (refs.length > 0) {
      chars.splice(endIdx, 0, ' ' + refs.join(''))
    }
  }

  return chars.join('')
}
