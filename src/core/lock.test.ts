import { describe, it, expect } from 'bun:test'
import { withLock, isLocked } from './lock'

describe('withLock', () => {
  it('executes function and returns result', async () => {
    const result = await withLock('test-1', async () => 42)
    expect(result).toBe(42)
  })

  it('releases lock after completion', async () => {
    await withLock('test-release', async () => 'done')
    expect(isLocked('test-release')).toBe(false)
  })

  it('allows sequential execution on same key', async () => {
    const results: number[] = []
    await withLock('test-seq', async () => { results.push(1) })
    await withLock('test-seq', async () => { results.push(2) })
    expect(results).toEqual([1, 2])
  })

  it('prevents concurrent execution of same key', async () => {
    const order: string[] = []
    const p1 = withLock('test-concurrent', async () => {
      order.push('start-1')
      await new Promise(r => setTimeout(r, 50))
      order.push('end-1')
    })
    // Start second lock attempt right away - it should wait
    const p2 = withLock('test-concurrent', async () => {
      order.push('start-2')
      await new Promise(r => setTimeout(r, 10))
      order.push('end-2')
    })
    await Promise.all([p1, p2])
    // 1 must complete before 2 starts
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2'])
  })

  it('allows concurrent execution of different keys', async () => {
    const order: string[] = []
    const p1 = withLock('key-a', async () => {
      order.push('start-a')
      await new Promise(r => setTimeout(r, 30))
      order.push('end-a')
    })
    const p2 = withLock('key-b', async () => {
      order.push('start-b')
      await new Promise(r => setTimeout(r, 10))
      order.push('end-b')
    })
    await Promise.all([p1, p2])
    // Both started before either finished
    expect(order[0]).toBe('start-a')
    expect(order[1]).toBe('start-b')
  })

  it('releases lock even when function throws', async () => {
    try {
      await withLock('test-error', async () => {
        throw new Error('boom')
      })
    } catch {
      // expected
    }
    expect(isLocked('test-error')).toBe(false)
  })

  it('propagates errors from locked function', async () => {
    await expect(
      withLock('test-prop', async () => { throw new Error('fail') })
    ).rejects.toThrow('fail')
  })
})
