import type { ConversationItem } from '../types'
import { randomUUID } from 'crypto'

// DB items -> Chat Completions messages
export function itemsToMessages(items: ConversationItem[]): any[] {
  const messages: any[] = []
  for (const item of items) {
    if (item.role === 'user') {
      messages.push({ role: 'user', content: item.content })
    } else if (item.role === 'assistant') {
      const msg: any = { role: 'assistant', content: item.content }
      // MUST preserve reasoning_content for DeepSeek V4
      if (item.reasoning_content) msg.reasoning_content = item.reasoning_content
      if (item.reasoning_details) msg.reasoning_details = JSON.parse(item.reasoning_details)
      if (item.tool_calls) msg.tool_calls = JSON.parse(item.tool_calls)
      messages.push(msg)
    } else if (item.role === 'tool') {
      messages.push({
        role: 'tool',
        content: item.content,
        tool_call_id: item.tool_call_id,
        name: item.name,
      })
    }
  }
  return messages
}

// Responses input -> Chat Completions messages (first turn only)
export function inputToMessages(input: string | any[], instructions?: string): any[] {
  const messages: any[] = []
  if (instructions) {
    messages.push({ role: 'system', content: instructions })
  }
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input })
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (item.role === 'user') {
        if (typeof item.content === 'string') {
          messages.push({ role: 'user', content: item.content })
        } else if (Array.isArray(item.content)) {
          // Multimodal content parts: convert Responses API format to Chat Completions format
          const contentParts: Array<Record<string, unknown>> = []
          for (const part of item.content) {
            if (part.type === 'input_text') {
              contentParts.push({ type: 'text', text: part.text })
            } else if (part.type === 'input_image_url') {
              contentParts.push({ type: 'image_url', image_url: { url: part.image_url?.url || part.url } })
            }
          }
          if (contentParts.length === 1 && contentParts[0].type === 'text') {
            messages.push({ role: 'user', content: (contentParts[0] as { text: string }).text })
          } else if (contentParts.length > 0) {
            messages.push({ role: 'user', content: contentParts })
          }
        }
      }
    }
  }
  return messages
}

// Chat Completions response -> Responses output items
export function responseToOutput(message: any): any[] {
  const items: any[] = []
  if (message.content) {
    items.push({
      type: 'message',
      id: `msg_${randomUUID().slice(0, 12)}`,
      role: 'assistant',
      content: [{ type: 'output_text', text: message.content }],
      status: 'completed',
    })
  }
  return items
}

// Build DB items for saving
export function buildSaveItems(
  conversationId: string,
  userContent: string,
  assistantMessage: any,
  reasoningContent?: string,
  reasoningDetails?: any
) {
  return [
    {
      id: `item_${randomUUID().slice(0, 12)}`,
      conversation_id: conversationId,
      role: 'user',
      content: userContent,
    },
    {
      id: `item_${randomUUID().slice(0, 12)}`,
      conversation_id: conversationId,
      role: 'assistant',
      content: assistantMessage.content || '',
      reasoning_content: reasoningContent || assistantMessage.reasoning_content || null,
      reasoning_details: reasoningDetails || assistantMessage.reasoning_details || null,
      tool_calls: assistantMessage.tool_calls || null,
    },
  ]
}
