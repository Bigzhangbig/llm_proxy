import { describe, it, expect } from 'bun:test'
import { injectSchema, tryParseJson } from './schema'

describe('injectSchema', () => {
  it('adds schema to existing system message', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ]
    const schema = { type: 'object', properties: { answer: { type: 'string' } } }
    const result = injectSchema(messages, schema)

    expect(result).toHaveLength(2)
    expect(result[0].role).toBe('system')
    expect(result[0].content).toContain('You are helpful.')
    expect(result[0].content).toContain('"type": "object"')
    expect(result[0].content).toContain('JSON Schema')
  })

  it('creates system message if none exists', () => {
    const messages = [{ role: 'user', content: 'Hello' }]
    const schema = { type: 'object', properties: { x: { type: 'number' } } }
    const result = injectSchema(messages, schema)

    expect(result).toHaveLength(2)
    expect(result[0].role).toBe('system')
    expect(result[0].content).toContain('JSON Schema')
    expect(result[0].content).toContain('"type": "object"')
    expect(result[1].role).toBe('user')
  })

  it('does not mutate non-system messages', () => {
    const messages = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'User' },
    ]
    injectSchema(messages, { type: 'object' })
    expect(messages[1].content).toBe('User')
  })
})

describe('tryParseJson', () => {
  it('parses valid JSON', () => {
    const result = tryParseJson('{"name": "test", "count": 42}')
    expect(result.valid).toBe(true)
    expect(result.parsed).toEqual({ name: 'test', count: 42 })
  })

  it('extracts JSON from markdown code blocks', () => {
    const text = 'Here is the result:\n```json\n{"key": "value"}\n```\nDone.'
    const result = tryParseJson(text)
    expect(result.valid).toBe(true)
    expect(result.parsed).toEqual({ key: 'value' })
  })

  it('returns null for invalid JSON', () => {
    const result = tryParseJson('not json at all')
    expect(result.valid).toBe(false)
    expect(result.parsed).toBeNull()
  })

  it('returns null for empty string', () => {
    const result = tryParseJson('')
    expect(result.valid).toBe(false)
    expect(result.parsed).toBeNull()
  })

  it('parses JSON arrays', () => {
    const result = tryParseJson('[1, 2, 3]')
    expect(result.valid).toBe(true)
    expect(result.parsed).toEqual([1, 2, 3])
  })

  it('handles JSON with extra text around code block', () => {
    const text = 'Let me format that for you:\n\n```json\n{"status": "ok"}\n```\n\nLet me know if you need anything else.'
    const result = tryParseJson(text)
    expect(result.valid).toBe(true)
    expect(result.parsed).toEqual({ status: 'ok' })
  })
})
