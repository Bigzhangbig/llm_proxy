import type { ConversationItem } from '../types'
import { randomUUID } from 'crypto'

export interface ChatMessage {
  role: string
  content: string | Array<Record<string, unknown>> | null
  reasoning_content?: string | null
  reasoning_details?: unknown
  tool_calls?: unknown
  tool_call_id?: string | null
  name?: string | null
}

// DB items -> Chat Completions messages
export function itemsToMessages(items: ConversationItem[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (const item of items) {
    if (item.role === 'user') {
      messages.push({ role: 'user', content: item.content })
    } else if (item.role === 'assistant') {
      const msg: ChatMessage = { role: 'assistant', content: item.content }
      if (item.reasoning_content) msg.reasoning_content = item.reasoning_content
      if (item.reasoning_details) {
        try { msg.reasoning_details = JSON.parse(item.reasoning_details) } catch (err) {
          console.warn('[Assembler] Failed to parse reasoning_details:', err)
        }
      }
      if (item.tool_calls) {
        try { msg.tool_calls = JSON.parse(item.tool_calls) } catch (err) {
          console.warn('[Assembler] Failed to parse tool_calls:', err)
        }
      }
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
export function inputToMessages(input: string | Array<Record<string, unknown>>, instructions?: string): ChatMessage[] {
  const messages: ChatMessage[] = []
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

// Build DB items for saving
export function buildSaveItems(
  conversationId: string,
  userContent: string,
  assistantMessage: { content?: string | null; reasoning_content?: string; reasoning_details?: unknown; tool_calls?: unknown },
  reasoningContent?: string,
  reasoningDetails?: unknown,
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
