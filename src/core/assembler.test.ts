import { describe, it, expect } from 'bun:test'
import { inputToMessages, itemsToMessages, buildSaveItems } from './assembler'
import type { ConversationItem } from '../types'

describe('inputToMessages', () => {
  it('converts string input to user message', () => {
    const result = inputToMessages('Hello, world!')
    expect(result).toEqual([{ role: 'user', content: 'Hello, world!' }])
  })

  it('converts string input with instructions to system + user messages', () => {
    const result = inputToMessages('Hello', 'You are helpful.')
    expect(result).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ])
  })

  it('converts array input to user messages', () => {
    const input = [
      { role: 'user', content: 'What is 2+2?' },
    ]
    const result = inputToMessages(input)
    expect(result).toEqual([{ role: 'user', content: 'What is 2+2?' }])
  })

  it('filters non-user items from array input', () => {
    const input = [
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'Follow up' },
    ]
    const result = inputToMessages(input)
    expect(result).toEqual([{ role: 'user', content: 'Follow up' }])
  })

  it('converts multimodal content parts to Chat Completions format', () => {
    const input = [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Describe this image' },
          { type: 'input_image_url', image_url: { url: 'https://example.com/img.png' } },
        ],
      },
    ]
    const result = inputToMessages(input)
    expect(result).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image' },
        { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
      ],
    }])
  })

  it('converts image-only input to Chat Completions format', () => {
    const input = [
      {
        role: 'user',
        content: [
          { type: 'input_image_url', image_url: { url: 'https://example.com/img.png' } },
        ],
      },
    ]
    const result = inputToMessages(input)
    expect(result).toEqual([{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
      ],
    }])
  })

  it('collapses single text part to plain string', () => {
    const input = [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Hello' },
        ],
      },
    ]
    const result = inputToMessages(input)
    expect(result).toEqual([{ role: 'user', content: 'Hello' }])
  })
})

describe('itemsToMessages', () => {
  it('converts DB items to chat messages', () => {
    const items: ConversationItem[] = [
      { id: '1', conversation_id: 'c1', role: 'user', content: 'Hi', reasoning_content: null, reasoning_details: null, tool_calls: null, tool_call_id: null, name: null, created_at: 0 },
      { id: '2', conversation_id: 'c1', role: 'assistant', content: 'Hello!', reasoning_content: null, reasoning_details: null, tool_calls: null, tool_call_id: null, name: null, created_at: 0 },
    ]
    const result = itemsToMessages(items)
    expect(result).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
    ])
  })

  it('preserves reasoning_content in assistant items', () => {
    const items: ConversationItem[] = [
      {
        id: '1',
        conversation_id: 'c1',
        role: 'assistant',
        content: 'The answer is 4.',
        reasoning_content: 'Let me think about this...',
        reasoning_details: null,
        tool_calls: null,
        tool_call_id: null,
        name: null,
        created_at: 0,
      },
    ]
    const result = itemsToMessages(items)
    expect(result).toEqual([
      { role: 'assistant', content: 'The answer is 4.', reasoning_content: 'Let me think about this...' },
    ])
  })

  it('parses reasoning_details JSON string', () => {
    const details = [{ text: 'step 1' }]
    const items: ConversationItem[] = [
      {
        id: '1',
        conversation_id: 'c1',
        role: 'assistant',
        content: 'Done',
        reasoning_content: null,
        reasoning_details: JSON.stringify(details),
        tool_calls: null,
        tool_call_id: null,
        name: null,
        created_at: 0,
      },
    ]
    const result = itemsToMessages(items)
    expect(result[0].reasoning_details).toEqual(details)
  })

  it('handles tool messages correctly', () => {
    const items: ConversationItem[] = [
      {
        id: '1',
        conversation_id: 'c1',
        role: 'tool',
        content: '{"result": 42}',
        reasoning_content: null,
        reasoning_details: null,
        tool_calls: null,
        tool_call_id: 'call_abc',
        name: 'calculator',
        created_at: 0,
      },
    ]
    const result = itemsToMessages(items)
    expect(result).toEqual([
      { role: 'tool', content: '{"result": 42}', tool_call_id: 'call_abc', name: 'calculator' },
    ])
  })

  it('parses tool_calls JSON string in assistant items', () => {
    const toolCalls = [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{}' } }]
    const items: ConversationItem[] = [
      {
        id: '1',
        conversation_id: 'c1',
        role: 'assistant',
        content: null,
        reasoning_content: null,
        reasoning_details: null,
        tool_calls: JSON.stringify(toolCalls),
        tool_call_id: null,
        name: null,
        created_at: 0,
      },
    ]
    const result = itemsToMessages(items)
    expect(result[0].tool_calls).toEqual(toolCalls)
  })
})

describe('buildSaveItems', () => {
  it('creates correct item structure with user and assistant entries', () => {
    const items = buildSaveItems('conv-1', 'Hello', { content: 'Hi there!' })
    expect(items).toHaveLength(2)
    expect(items[0].role).toBe('user')
    expect(items[0].content).toBe('Hello')
    expect(items[0].conversation_id).toBe('conv-1')
    expect(items[0].id).toStartWith('item_')
    expect(items[1].role).toBe('assistant')
    expect(items[1].content).toBe('Hi there!')
    expect(items[1].conversation_id).toBe('conv-1')
  })

  it('includes reasoning_content when provided', () => {
    const items = buildSaveItems('conv-1', 'Q', { content: 'A' }, 'my reasoning')
    expect(items[1].reasoning_content).toBe('my reasoning')
  })

  it('falls back to assistant message reasoning_content', () => {
    const items = buildSaveItems('conv-1', 'Q', { content: 'A', reasoning_content: 'from msg' })
    expect(items[1].reasoning_content).toBe('from msg')
  })

  it('sets null reasoning when neither provided', () => {
    const items = buildSaveItems('conv-1', 'Q', { content: 'A' })
    expect(items[1].reasoning_content).toBeNull()
  })
})
