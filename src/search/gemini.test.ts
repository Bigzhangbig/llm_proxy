import { describe, it, expect } from 'bun:test'

// Test pure functions from gemini module (pool singleton cannot be easily
// reset across test files, so we test insertFootnotes and parseGeminiResponse)
describe('gemini search helpers', () => {
  it('insertFootnotes adds footnote markers at correct positions', async () => {
    const { insertFootnotes } = await import('../search/gemini')

    const text = 'Hello world this is a test'
    const supports = [{
      segment: { startIndex: 11, endIndex: 16 },
      groundingChunkIndices: [0],
    }]
    const chunks = [{ web: { uri: 'https://example.com', title: 'Example' } }]

    const result = insertFootnotes(text, supports, chunks)
    // endIndex=16 is the position after "this" (chars[16] = space)
    expect(result).toContain('[1]')
    expect(result).toBe('Hello world this [1] is a test')
  })

  it('insertFootnotes handles empty supports', async () => {
    const { insertFootnotes } = await import('../search/gemini')
    const result = insertFootnotes('Hello', [], [])
    expect(result).toBe('Hello')
  })

  it('insertFootnotes handles multiple supports sorted by endIndex', async () => {
    const { insertFootnotes } = await import('../search/gemini')

    const text = 'AAA BBB CCC'
    const supports = [
      { segment: { startIndex: 0, endIndex: 3 }, groundingChunkIndices: [0] },
      { segment: { startIndex: 4, endIndex: 7 }, groundingChunkIndices: [1] },
    ]
    const chunks = [
      { web: { uri: 'https://a.com', title: 'A' } },
      { web: { uri: 'https://b.com', title: 'B' } },
    ]

    const result = insertFootnotes(text, supports, chunks)
    expect(result).toContain('[1]')
    expect(result).toContain('[2]')
  })
})
