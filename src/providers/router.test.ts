import { describe, it, expect } from 'bun:test'
import { resolveProvider } from './router'

describe('resolveProvider', () => {
  it('resolves deepseek model', () => {
    const { name } = resolveProvider('deepseek-v4-pro')
    expect(name).toBe('deepseek')
  })

  it('resolves kimi model', () => {
    const { name } = resolveProvider('kimi-k2.6')
    expect(name).toBe('kimi')
  })

  it('resolves minimax model', () => {
    const { name } = resolveProvider('MiniMax-M2.7')
    expect(name).toBe('minimax')
  })

  it('resolves mimo model', () => {
    const { name } = resolveProvider('mimo-v2.5-pro')
    expect(name).toBe('mimo')
  })

  it('defaults to deepseek for unknown model', () => {
    const { name } = resolveProvider('gpt-4o')
    expect(name).toBe('deepseek')
  })
})
