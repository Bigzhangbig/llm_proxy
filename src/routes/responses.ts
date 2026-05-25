import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { randomUUID } from 'crypto'
import { config } from '../config'
import { appendItems, getConversationItems } from '../db'
import { inputToMessages, itemsToMessages, buildSaveItems } from '../core/assembler'
import { injectSchema, tryParseJson } from '../core/schema'
import { buildDeepSeekRequest, getDeepSeekHeaders, getDeepSeekUrl } from '../providers/deepseek'
import { parseSSELines } from '../core/stream'
import type { ResponsesRequest, ResponsesResponse } from '../types'

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

  // Non-streaming
  if (!body.stream) {
    try {
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
