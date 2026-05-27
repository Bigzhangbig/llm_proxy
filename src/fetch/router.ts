import { downloadPage } from './downloader'
import { extractWithMineru } from './mineru'
import { extractWithLlm } from './llm'

export type FetchProvider = 'mineru' | 'gemini' | 'cloudflare'

export interface FetchResult {
  title: string
  content: string
}

export async function fetchPage(url: string): Promise<FetchResult> {
  const provider = (Bun.env.FETCH_PROVIDER || 'mineru') as FetchProvider

  const { html, title } = await downloadPage(url)

  let content: string
  switch (provider) {
    case 'mineru':
      content = await extractWithMineru(html)
      break
    case 'gemini':
    case 'cloudflare':
      content = await extractWithLlm(html, url, title)
      break
    default:
      content = await extractWithMineru(html)
  }

  return { title, content }
}
