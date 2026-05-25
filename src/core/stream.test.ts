import { describe, it, expect } from 'bun:test'
import { parseSSELines } from './stream'

describe('parseSSELines', () => {
  it('parses complete SSE lines', () => {
    const input = 'data: {"id":"1","object":"chat"}\ndata: {"id":"2","object":"chat"}\n'
    const { lines, remaining } = parseSSELines(input)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({ id: '1', object: 'chat' })
    expect(lines[1]).toEqual({ id: '2', object: 'chat' })
    expect(remaining).toBe('')
  })

  it('handles incomplete lines (returns as remaining)', () => {
    const input = 'data: {"id":"1"}\ndata: {"id":'
    const { lines, remaining } = parseSSELines(input)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual({ id: '1' })
    expect(remaining).toBe('data: {"id":')
  })

  it('handles [DONE] marker', () => {
    const input = 'data: {"chunk": 1}\ndata: [DONE]\n'
    const { lines, remaining } = parseSSELines(input)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({ chunk: 1 })
    expect(lines[1]).toEqual({ done: true })
    expect(remaining).toBe('')
  })

  it('skips empty lines and comments', () => {
    const input = '\n: this is a comment\ndata: {"a":1}\n\n: another comment\ndata: {"b":2}\n'
    const { lines, remaining } = parseSSELines(input)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({ a: 1 })
    expect(lines[1]).toEqual({ b: 2 })
  })

  it('skips malformed JSON data lines', () => {
    const input = 'data: {broken json}\ndata: {"ok": true}\n'
    const { lines, remaining } = parseSSELines(input)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual({ ok: true })
  })

  it('handles multiple data lines as separate JSON objects', () => {
    const input =
      'data: {"delta": "Hello"}\ndata: {"delta": " world"}\ndata: {"delta": "!"}\n'
    const { lines, remaining } = parseSSELines(input)
    expect(lines).toHaveLength(3)
    expect(lines[0].delta).toBe('Hello')
    expect(lines[1].delta).toBe(' world')
    expect(lines[2].delta).toBe('!')
  })

  it('returns empty lines for buffer with only incomplete data', () => {
    const { lines, remaining } = parseSSELines('data: {"partial"')
    expect(lines).toHaveLength(0)
    expect(remaining).toBe('data: {"partial"')
  })

  it('handles event: lines by ignoring them (only data: matters)', () => {
    const input = 'event: chat\ndata: {"text": "hi"}\n'
    const { lines, remaining } = parseSSELines(input)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual({ text: 'hi' })
  })

  it('handles empty buffer', () => {
    const { lines, remaining } = parseSSELines('')
    expect(lines).toHaveLength(0)
    expect(remaining).toBe('')
  })
})
