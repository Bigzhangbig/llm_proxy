import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { downloadPage, hashContent } from './downloader'

describe('downloader', () => {
  const originalSpawn = Bun.spawn

  afterEach(() => {
    Bun.spawn = originalSpawn
  })

  it('exports downloadPage function', () => {
    expect(typeof downloadPage).toBe('function')
  })

  it('exports hashContent function', () => {
    expect(typeof hashContent).toBe('function')
  })

  it('hashContent returns consistent md5 hash', () => {
    const hash1 = hashContent('hello world')
    const hash2 = hashContent('hello world')
    expect(hash1).toBe(hash2)
    expect(hash1.length).toBe(12)
  })

  it('hashContent returns different hash for different content', () => {
    const hash1 = hashContent('hello')
    const hash2 = hashContent('world')
    expect(hash1).not.toBe(hash2)
  })
})
