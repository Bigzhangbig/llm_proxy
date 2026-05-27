import { createHash } from 'crypto'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const MAX_HTML_SIZE = 5 * 1024 * 1024 // 5MB

export interface DownloadResult {
  html: string
  title: string
}

export async function downloadPage(url: string): Promise<DownloadResult> {
  const args = [
    '-L', '-s',
    '--max-time', '15',
    '--connect-timeout', '5',
    '-A', USER_AGENT,
  ]

  const proxy = Bun.env.HTTP_PROXY || Bun.env.http_proxy
  if (proxy) {
    args.push('--proxy', proxy)
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error(`Invalid URL: must start with http:// or https://`)
  }

  args.push('--', url)

  const proc = Bun.spawn(['curl', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Failed to download page: curl exited with code ${exitCode}`)
  }

  let html = await new Response(proc.stdout).text()

  if (html.length > MAX_HTML_SIZE) {
    console.warn(`[Fetch] HTML too large (${html.length} bytes), truncating to ${MAX_HTML_SIZE}`)
    html = html.slice(0, MAX_HTML_SIZE)
  }

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = titleMatch?.[1]?.trim() || ''

  return { html, title }
}

export function hashContent(html: string): string {
  return createHash('md5').update(html).digest('hex').slice(0, 12)
}
