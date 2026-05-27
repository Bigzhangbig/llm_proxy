import { describe, it, expect, mock } from 'bun:test'

describe('fetch router', () => {
  it('exports fetchPage function', async () => {
    const { fetchPage } = await import('./router')
    expect(typeof fetchPage).toBe('function')
  })
})
