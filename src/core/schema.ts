// Inject JSON Schema into system message if model doesn't support native structured output
export function injectSchema(messages: any[], schema: any): any[] {
  const schemaStr = JSON.stringify(schema, null, 2)
  const injection = `\n\n你必须严格按照以下 JSON Schema 输出，不要输出任何其他内容：\n\`\`\`json\n${schemaStr}\n\`\`\``

  // Find system message or create one
  const systemIdx = messages.findIndex(m => m.role === 'system')
  if (systemIdx >= 0) {
    messages[systemIdx].content += injection
  } else {
    messages.unshift({ role: 'system', content: `你是一个有用的助手。${injection}` })
  }
  return messages
}

// Validate and parse JSON from model output
export function tryParseJson(text: string): { parsed: any | null; valid: boolean } {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/)
    const jsonStr = jsonMatch ? jsonMatch[1] : text
    const parsed = JSON.parse(jsonStr.trim())
    return { parsed, valid: true }
  } catch {
    return { parsed: null, valid: false }
  }
}
