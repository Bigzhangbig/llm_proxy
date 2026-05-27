// Parse raw SSE text into structured chunks
export function parseSSELines(buffer: string): { lines: any[]; remaining: string } {
  const lines: any[] = []
  const parts = buffer.split('\n')
  const remaining = parts.pop() || '' // last part may be incomplete

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed || trimmed.startsWith(':')) continue // skip empty/comment lines
    if (trimmed.startsWith('data: ')) {
      const data = trimmed.slice(6)
      if (data === '[DONE]') {
        lines.push({ done: true })
      } else {
        try {
          lines.push(JSON.parse(data))
        } catch (err) {
          console.warn('[Stream] Malformed SSE JSON:', err)
        }
      }
    }
  }

  return { lines, remaining }
}
