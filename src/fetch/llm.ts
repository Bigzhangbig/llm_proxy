import { config } from '../config'

const DEFAULT_MAX_LENGTH = 30000
const DEFAULT_MODEL = 'gemini-2.5-flash-lite'

const EXTRACT_PROMPT = `Extract the main content from this HTML page. Remove all ads, navigation menus, footers, scripts, styles, and other non-content elements. Output clean, readable Markdown that preserves the article's structure (headings, paragraphs, lists, tables, code blocks). If there is no meaningful article content, output "[no content]".

HTML:
`

export async function extractWithLlm(html: string, url: string, title: string): Promise<string> {
  const maxLength = Number(Bun.env.FETCH_MAX_LENGTH || DEFAULT_MAX_LENGTH)
  const truncatedHtml = html.length > maxLength ? html.slice(0, maxLength) : html
  const prompt = EXTRACT_PROMPT + truncatedHtml

  const baseUrl = Bun.env.FETCH_LLM_BASE_URL
  const apiKey = Bun.env.FETCH_LLM_API_KEY
  const model = Bun.env.FETCH_LLM_MODEL || DEFAULT_MODEL

  if (!baseUrl || !apiKey) {
    throw new Error('FETCH_LLM_BASE_URL and FETCH_LLM_API_KEY are required for LLM fetch provider')
  }

  // Detect Cloudflare Workers AI format
  const isCloudflare = baseUrl.includes('workers.ai')

  let requestBody: Record<string, unknown>
  let endpoint: string
  let headers: Record<string, string>

  if (isCloudflare) {
    const accountId = Bun.env.CLOUDFLARE_ACCOUNT_ID
    if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID required for Cloudflare fetch provider')
    endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`
    headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    requestBody = {
      messages: [
        { role: 'system', content: 'You are a web content extractor. Output only the article content in Markdown.' },
        { role: 'user', content: prompt },
      ],
      stream: false,
    }
  } else {
    endpoint = `${baseUrl}/chat/completions`
    headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    requestBody = {
      model,
      messages: [
        { role: 'system', content: 'You are a web content extractor. Output only the article content in Markdown.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      stream: false,
    }
  }

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`LLM extract failed (${resp.status}): ${text}`)
  }

  const data = await resp.json() as Record<string, unknown>

  // Cloudflare format: { result: { response: "..." } }
  if (isCloudflare) {
    const result = data.result as Record<string, unknown> | undefined
    return (result?.response as string) || ''
  }

  // OpenAI-compatible format
  const choices = data.choices as Array<Record<string, unknown>> | undefined
  const message = choices?.[0]?.message as Record<string, unknown> | undefined
  return (message?.content as string) || ''
}
