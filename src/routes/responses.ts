import { Hono } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import { randomUUID } from 'crypto'
import { config } from '../config'
import { appendItems, getConversationItems } from '../db'
import { inputToMessages, itemsToMessages, buildSaveItems } from '../core/assembler'
import { injectSchema, tryParseJson } from '../core/schema'
import { buildDeepSeekRequest, getDeepSeekHeaders, getDeepSeekUrl } from '../providers/deepseek'
import { parseSSELines } from '../core/stream'
import { search } from '../search/router'
import type { ResponsesRequest, ResponsesResponse } from '../types'

const MAX_AGENTIC_ROUNDS = 3

async function agenticLoop(
  messages: Array<Record<string, unknown>>,
  providerRequest: Record<string, unknown>,
  responseId: string,
  stream?: SSEStreamingApi,
): Promise<{ fullContent: string; fullReasoning: string; usage: Record<string, unknown> | null }> {
  let round = 0
  let fullContent = ''
  let fullReasoning = ''
  let lastUsage: Record<string, unknown> | null = null

  while (round < MAX_AGENTIC_ROUNDS) {
    round++

    const resp = await fetch(getDeepSeekUrl(), {
      method: 'POST',
      headers: getDeepSeekHeaders(),
      body: JSON.stringify(providerRequest),
    })

    if (!resp.ok) {
      throw new Error(`Provider error: ${resp.status}`)
    }

    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let reasoning = ''
    const toolCalls = new Map<number, { id: string; type: string; function: { name: string; arguments: string } }>()
    let usage: Record<string, unknown> | null = null
    let reasoningSent = false
    let messageSent = false
    let shouldContinue = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { lines, remaining } = parseSSELines(buffer)
      buffer = remaining

      for (const chunk of lines) {
        if (chunk.done) continue
        if (chunk.usage) usage = chunk.usage

        const delta = chunk.choices?.[0]?.delta
        const finishReason = chunk.choices?.[0]?.finish_reason

        if (delta?.reasoning_content) reasoning += delta.reasoning_content
        if (delta?.content) content += delta.content
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolCalls.has(tc.index)) {
              toolCalls.set(tc.index, { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } })
            }
            const existing = toolCalls.get(tc.index)!
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.function.name += tc.function.name
            if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
          }
        }

        // Emit SSE events when streaming
        if (stream) {
          if (delta?.reasoning_content) {
            if (!reasoningSent) {
              reasoningSent = true
              await stream.writeSSE({
                event: 'response.output_item.added',
                data: JSON.stringify({
                  type: 'response.output_item.added',
                  response_id: responseId,
                  output_index: 0,
                  item: { type: 'reasoning', id: `rs_${responseId}`, status: 'in_progress', summary: [] },
                }),
              })
            }
            await stream.writeSSE({
              event: 'response.reasoning_summary_text.delta',
              data: JSON.stringify({
                type: 'response.reasoning_summary_text.delta',
                response_id: responseId,
                item_id: `rs_${responseId}`,
                output_index: 0,
                content_index: 0,
                delta: delta.reasoning_content,
              }),
            })
          }

          if (delta?.content) {
            if (!messageSent) {
              if (reasoningSent) {
                await stream.writeSSE({
                  event: 'response.output_item.done',
                  data: JSON.stringify({
                    type: 'response.output_item.done',
                    response_id: responseId,
                    output_index: 0,
                    item: {
                      type: 'reasoning',
                      id: `rs_${responseId}`,
                      status: 'completed',
                      summary: [{ type: 'summary_text', text: reasoning }],
                    },
                  }),
                })
              }
              messageSent = true
              await stream.writeSSE({
                event: 'response.output_item.added',
                data: JSON.stringify({
                  type: 'response.output_item.added',
                  response_id: responseId,
                  output_index: reasoningSent ? 1 : 0,
                  item: { type: 'message', id: `msg_${responseId}`, status: 'in_progress', role: 'assistant', content: [] },
                }),
              })
            }
            await stream.writeSSE({
              event: 'response.output_text.delta',
              data: JSON.stringify({
                type: 'response.output_text.delta',
                response_id: responseId,
                item_id: `msg_${responseId}`,
                output_index: reasoningSent ? 1 : 0,
                content_index: 0,
                delta: delta.content,
              }),
            })
          }
        }

        // Check for _gateway_web_search tool call
        if (finishReason === 'tool_calls') {
          const allToolCalls = Array.from(toolCalls.values())
          const searchCall = allToolCalls.find((tc) => tc.function.name === '_gateway_web_search')

          if (searchCall) {
            let searchQuery = ''
            try {
              const args = JSON.parse(searchCall.function.arguments) as { query?: string }
              searchQuery = args.query || ''
            } catch {
              searchQuery = searchCall.function.arguments
            }

            console.log(`[AgenticLoop] Round ${round}: searching "${searchQuery}"`)
            const results = await search(searchQuery)
            const searchContext = results
              .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`)
              .join('\n\n')

            messages.push({
              role: 'assistant',
              content: content || null,
              tool_calls: allToolCalls,
            })

            messages.push({
              role: 'tool',
              tool_call_id: searchCall.id,
              content: searchContext || 'No search results found.',
            })

            fullContent = content
            fullReasoning = reasoning
            lastUsage = usage
            shouldContinue = true
            break
          }
        }
      }

      if (shouldContinue) break
    }

    if (!shouldContinue) {
      fullContent = content
      fullReasoning = reasoning
      lastUsage = usage
      break
    }
  }

  return { fullContent, fullReasoning, usage: lastUsage }
}

export const responsesRouter = new Hono()

responsesRouter.post('/responses', async (c) => {
  const body = await c.req.json() as ResponsesRequest
  const responseId = `resp_${randomUUID().slice(0, 12)}`
  const conversationId = body.conversation || body.previous_response_id || `conv_${randomUUID().slice(0, 12)}`

  // Build messages array
  let messages: any[] = []
  const existingItems = getConversationItems(conversationId) as any[]
  if (existingItems.length > 0) {
    messages = itemsToMessages(existingItems)
  }
  const inputMessages = inputToMessages(body.input, body.instructions)
  if (existingItems.length > 0) {
    messages.push(...inputMessages.filter(m => m.role === 'user'))
  } else {
    messages.push(...inputMessages)
  }

  // Schema fallback
  if (body.text?.format?.type === 'json_schema') {
    messages = injectSchema(messages, body.text.format.schema)
  }

  const providerRequest = buildDeepSeekRequest(messages, {
    stream: body.stream,
    tools: body.tools,
    tool_choice: body.tool_choice,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
  })

  // Web search tool injection
  const hasSearchTool = body.tools?.some((t: { type?: string }) => t.type === 'web_search')

  if (hasSearchTool) {
    providerRequest.tools = [
      ...(providerRequest.tools || []).filter((t: { type?: string }) => t.type !== 'web_search'),
      {
        type: 'function',
        function: {
          name: '_gateway_web_search',
          description: 'Search the web for current information',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The search query' },
            },
            required: ['query'],
          },
        },
      },
    ]
  }

  // Non-streaming
  if (!body.stream) {
    try {
      // Use agentic loop when web search tools are present
      if (hasSearchTool) {
        const result = await agenticLoop(messages, providerRequest, responseId)
        let outputParsed = null
        if (body.text?.format?.type === 'json_schema' && result.fullContent) {
          const { parsed } = tryParseJson(result.fullContent)
          outputParsed = parsed
        }
        const response: ResponsesResponse = {
          id: responseId,
          object: 'response',
          status: 'completed',
          output: result.fullContent
            ? [{
                type: 'message',
                id: `msg_${randomUUID().slice(0, 12)}`,
                role: 'assistant',
                content: [{ type: 'output_text', text: result.fullContent }],
                status: 'completed',
              }]
            : [],
          usage: result.usage
            ? {
                input_tokens: Number(result.usage.prompt_tokens) || 0,
                output_tokens: Number(result.usage.completion_tokens) || 0,
                total_tokens: Number(result.usage.total_tokens) || 0,
                output_tokens_details: { reasoning_tokens: (result.usage.completion_tokens_details as Record<string, number>)?.reasoning_tokens || 0 },
              }
            : undefined,
          output_parsed: outputParsed,
        }
        if (result.fullContent) {
          appendItems(conversationId, buildSaveItems(
            conversationId,
            typeof body.input === 'string' ? body.input : JSON.stringify(body.input),
            { content: result.fullContent, reasoning_content: result.fullReasoning || undefined },
            result.fullReasoning || undefined,
          ))
        }
        return c.json(response)
      }

      // Standard non-streaming path
      const resp = await fetch(getDeepSeekUrl(), {
        method: 'POST',
        headers: getDeepSeekHeaders(),
        body: JSON.stringify(providerRequest),
      })
      if (!resp.ok) {
        return c.json({ error: { message: await resp.text(), code: resp.status } }, resp.status as any)
      }
      const data = await resp.json() as any
      const msg = data.choices?.[0]?.message
      let outputParsed = null
      if (body.text?.format?.type === 'json_schema' && msg?.content) {
        const { parsed } = tryParseJson(msg.content)
        outputParsed = parsed
      }
      const response: ResponsesResponse = {
        id: responseId,
        object: 'response',
        status: 'completed',
        output: msg
          ? [{
              type: 'message',
              id: `msg_${randomUUID().slice(0, 12)}`,
              role: 'assistant',
              content: [{ type: 'output_text', text: msg.content || '' }],
              status: 'completed',
            }]
          : [],
        usage: data.usage
          ? {
              input_tokens: data.usage.prompt_tokens,
              output_tokens: data.usage.completion_tokens,
              total_tokens: data.usage.total_tokens,
              output_tokens_details: { reasoning_tokens: data.usage.completion_tokens_details?.reasoning_tokens || 0 },
            }
          : undefined,
        output_parsed: outputParsed,
      }
      if (msg) {
        appendItems(conversationId, buildSaveItems(
          conversationId,
          typeof body.input === 'string' ? body.input : JSON.stringify(body.input),
          msg,
          msg.reasoning_content,
          msg.reasoning_details
        ))
      }
      return c.json(response)
    } catch (err: any) {
      return c.json({ error: { message: err.message, type: 'internal_error' } }, 500)
    }
  }

  // Streaming
  try {
    // Use agentic loop when web search tools are present
    if (hasSearchTool) {
      return streamSSE(c, async (stream) => {
        let aborted = false
        stream.onAbort(() => { aborted = true })

        try {
          const result = await agenticLoop(messages, providerRequest, responseId, stream)

          // Finalize: message done
          if (result.fullContent || result.fullReasoning) {
            await stream.writeSSE({
              event: 'response.output_item.done',
              data: JSON.stringify({
                type: 'response.output_item.done',
                response_id: responseId,
                output_index: result.fullReasoning ? 1 : 0,
                item: {
                  type: 'message',
                  id: `msg_${responseId}`,
                  status: 'completed',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: result.fullContent }],
                },
              }),
            })
          }

          // Completed event
          const usageData = result.usage
            ? {
                input_tokens: result.usage.prompt_tokens || 0,
                output_tokens: result.usage.completion_tokens || 0,
                total_tokens: result.usage.total_tokens || 0,
              }
            : { input_tokens: 0, output_tokens: 0, total_tokens: 0 }

          await stream.writeSSE({
            event: 'response.completed',
            data: JSON.stringify({
              type: 'response.completed',
              response_id: responseId,
              status: 'completed',
              usage: usageData,
            }),
          })

          // Save to DB
          if (result.fullContent || result.fullReasoning) {
            appendItems(conversationId, buildSaveItems(
              conversationId,
              typeof body.input === 'string' ? body.input : JSON.stringify(body.input),
              { content: result.fullContent, reasoning_content: result.fullReasoning || undefined },
              result.fullReasoning || undefined,
            ))
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({ error: { message, type: 'internal_error' } }),
          })
        }
      })
    }

    // Standard streaming path
    return streamSSE(c, async (stream) => {
      let aborted = false
      stream.onAbort(() => { aborted = true })

      const upstreamResp = await fetch(getDeepSeekUrl(), {
        method: 'POST',
        headers: getDeepSeekHeaders(),
        body: JSON.stringify(providerRequest),
      })
      if (!upstreamResp.ok) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: { message: await upstreamResp.text(), code: upstreamResp.status } }),
        })
        return
      }

      const reader = upstreamResp.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let reasoningSent = false
      let messageSent = false
      let fullReasoning = ''
      let fullContent = ''
      let lastUsage: any = null
      const itemId = `rs_${randomUUID().slice(0, 12)}`
      const msgItemId = `msg_${randomUUID().slice(0, 12)}`

      while (true) {
        if (aborted) break
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { lines, remaining } = parseSSELines(buffer)
        buffer = remaining

        for (const chunk of lines) {
          if (chunk.done) continue
          const delta = chunk.choices?.[0]?.delta
          if (!delta) continue

          const hasReasoning = delta.reasoning_content || (delta.reasoning_details?.length > 0)

          // Emit reasoning added
          if (hasReasoning && !reasoningSent) {
            reasoningSent = true
            await stream.writeSSE({
              event: 'response.output_item.added',
              data: JSON.stringify({
                type: 'response.output_item.added',
                response_id: responseId,
                output_index: 0,
                item: { type: 'reasoning', id: itemId, status: 'in_progress', summary: [] },
              }),
            })
          }

          // Emit reasoning delta
          if (delta.reasoning_content) {
            fullReasoning += delta.reasoning_content
            await stream.writeSSE({
              event: 'response.reasoning_summary_text.delta',
              data: JSON.stringify({
                type: 'response.reasoning_summary_text.delta',
                response_id: responseId,
                item_id: itemId,
                output_index: 0,
                content_index: 0,
                delta: delta.reasoning_content,
              }),
            })
          } else if (delta.reasoning_details?.length > 0) {
            for (const d of delta.reasoning_details) {
              if (d.text) {
                fullReasoning += d.text
                await stream.writeSSE({
                  event: 'response.reasoning_summary_text.delta',
                  data: JSON.stringify({
                    type: 'response.reasoning_summary_text.delta',
                    response_id: responseId,
                    item_id: itemId,
                    output_index: 0,
                    content_index: 0,
                    delta: d.text,
                  }),
                })
              }
            }
          }

          // Transition: reasoning done + message added
          if (hasReasoning && delta.content && !messageSent) {
            await stream.writeSSE({
              event: 'response.output_item.done',
              data: JSON.stringify({
                type: 'response.output_item.done',
                response_id: responseId,
                output_index: 0,
                item: {
                  type: 'reasoning',
                  id: itemId,
                  status: 'completed',
                  summary: [{ type: 'summary_text', text: fullReasoning }],
                },
              }),
            })
            messageSent = true
            await stream.writeSSE({
              event: 'response.output_item.added',
              data: JSON.stringify({
                type: 'response.output_item.added',
                response_id: responseId,
                output_index: 1,
                item: { type: 'message', id: msgItemId, status: 'in_progress', role: 'assistant', content: [] },
              }),
            })
          }

          // Emit text delta
          if (delta.content) {
            if (!messageSent && !reasoningSent) {
              messageSent = true
              await stream.writeSSE({
                event: 'response.output_item.added',
                data: JSON.stringify({
                  type: 'response.output_item.added',
                  response_id: responseId,
                  output_index: 0,
                  item: { type: 'message', id: msgItemId, status: 'in_progress', role: 'assistant', content: [] },
                }),
              })
            }
            fullContent += delta.content
            await stream.writeSSE({
              event: 'response.output_text.delta',
              data: JSON.stringify({
                type: 'response.output_text.delta',
                response_id: responseId,
                item_id: msgItemId,
                output_index: reasoningSent ? 1 : 0,
                content_index: 0,
                delta: delta.content,
              }),
            })
          }

          if (chunk.usage) {
            lastUsage = chunk.usage
          }
        }
      }

      // Finalize: message done
      if (messageSent || reasoningSent) {
        await stream.writeSSE({
          event: 'response.output_item.done',
          data: JSON.stringify({
            type: 'response.output_item.done',
            response_id: responseId,
            output_index: reasoningSent ? 1 : 0,
            item: {
              type: 'message',
              id: msgItemId,
              status: 'completed',
              role: 'assistant',
              content: [{ type: 'output_text', text: fullContent }],
            },
          }),
        })
      }

      // Completed
      const usageData = lastUsage
        ? {
            input_tokens: lastUsage.prompt_tokens || 0,
            output_tokens: lastUsage.completion_tokens || 0,
            total_tokens: lastUsage.total_tokens || 0,
          }
        : { input_tokens: 0, output_tokens: 0, total_tokens: 0 }

      await stream.writeSSE({
        event: 'response.completed',
        data: JSON.stringify({
          type: 'response.completed',
          response_id: responseId,
          status: 'completed',
          usage: usageData,
        }),
      })

      // Save to DB
      if (fullContent || fullReasoning) {
        appendItems(conversationId, buildSaveItems(
          conversationId,
          typeof body.input === 'string' ? body.input : JSON.stringify(body.input),
          { content: fullContent, reasoning_content: fullReasoning || undefined }
        ))
      }
    })
  } catch (err: any) {
    return c.json({ error: { message: err.message, type: 'internal_error' } }, 500)
  }
})
