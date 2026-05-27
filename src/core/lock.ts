const locks = new Map<string, { promise: Promise<void>; resolve: () => void }>()

const LOCK_TIMEOUT = 10_000 // 10 seconds

export async function withLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  // Wait for existing lock
  while (locks.has(conversationId)) {
    await locks.get(conversationId)!.promise
  }

  // Create new lock
  let resolveLock!: () => void
  const promise = new Promise<void>(resolve => { resolveLock = resolve })
  locks.set(conversationId, { promise, resolve: resolveLock })

  // Timeout protection
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    resolveLock()
    locks.delete(conversationId)
  }, LOCK_TIMEOUT)

  try {
    if (timedOut) {
      throw new Error(`Lock timeout for conversation ${conversationId}`)
    }
    return await fn()
  } finally {
    clearTimeout(timeout)
    if (!timedOut) {
      resolveLock()
      locks.delete(conversationId)
    }
  }
}

export function isLocked(conversationId: string): boolean {
  return locks.has(conversationId)
}
