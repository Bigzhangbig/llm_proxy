import { Hono } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import { randomUUID } from 'crypto'
import { config, type ProviderConfig } from '../config'
import { appendItems, getConversationItems } from '../db'
import { inputToMessages, itemsToMessages, buildSaveItems, type ChatMessage } from '../core/assembler'
import { injectSchema, tryParseJson } from '../core/schema'
import { resolveProvider, buildProviderRequest, getProviderHeaders, getProviderUrl } from '../providers/router'
import { buildKimiRequest } from '../providers/kimi'
import { buildMiniMaxRequest } from '../providers/minimax'
import { buildMiMoRequest } from '../providers/mimo'
import { parseSSELines } from '../core/stream'
import { search } from '../search/router'
import { fetchPage } from '../fetch/router'
import type { ResponsesRequest, ResponsesResponse, ConversationItem } from '../types'

const MAX_AGENTIC_ROUNDS = Number(Bun.env.MAX_AGENTIC_ROUNDS || '3')

interface GatewayToolCall {
  id: string
  type: string
  function: { name: string; arguments: string }
}

function isGatewayTool(name: string): boolean {
  return name === '_gateway_web_search' || name === '_gateway_web_fetch'
}

function isNativeTool(name: string): boolean {
  // Kimi $web_search and MiMo web_search are executed server-side by the provider
  return name === '$web_search' || name === 'web_search'
}

interface AgenticResult {
  fullContent: string
  fullReasoning: string
  usage: Record<string, unknown> | null
  toolCalls?: GatewayToolCall[]
}

async function executeGatewayTool(call: GatewayToolCall): Promise<string> {
  const args = (() => {
    try { return JSON.parse(call.function.arguments) as Record<string, unknown> } catch { return {} }
  })()

  if (call.function.name === '_gateway_web_search') {
    const query = (args.query as string) || call.function.arguments
    console.log(`[Gateway] Searching: "${query}"`)
    const results = await search(query)
    console.log(`[Gateway] Got ${results.length} search results`)
    return results.length > 0
      ? results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`).join('\n\n')
      : 'No search results found.'
  }

  if (call.function.name === '_gateway_web_fetch') {
    const url = (args.url as string) || ''
    if (!url) return 'Error: No URL provided.'
    console.log(`[Gateway] Fetching: "${url}"`)
    try {
      const result = await fetchPage(url)
      return `Title: ${result.title}\nURL: ${url}\n---\n${result.content}`
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[Gateway] Fetch failed: ${msg}`)
      return `Error fetching URL: ${msg}`
    }
  }

  return `Error: Unknown gateway tool ${call.function.name}`
}

async function agenticLoop(
  messages: Array<Record<string, unknown>>,
  providerRequest: Record<string, unknown>,
  providerConfig: ProviderConfig,
  responseId: string,
  hasGatewayTools: boolean,
  stream?: SSEStreamingApi,
): Promise<AgenticResult> {
  let round = 0
  let fullContent = ''
  let fullReasoning = ''
  let lastUsage: Record<string, unknown> | null = null

  const providerUrl = getProviderUrl(providerConfig)
  const providerHeaders = getProviderHeaders(providerConfig)

  while (round < MAX_AGENTIC_ROUNDS) {
    round++
    console.log(`[AgenticLoop] Round ${round}`)

    const resp = await fetch(providerUrl, {
      method: 'POST',
      headers: providerHeaders,
      body: JSON.stringify(providerRequest),
    })

    if (!resp.ok) {
      const errorBody = await resp.text()
      console.error(`[AgenticLoop] Round ${round}: Provider error ${resp.status}: ${errorBody}`)
      if (providerRequest.tools) {
        console.error(`[AgenticLoop] Tools: ${JSON.stringify(providerRequest.tools).slice(0, 300)}`)
      }
      throw new Error(`Provider error: ${resp.status}`)
    }

    let content = ''
    let reasoning = ''
    const toolCalls = new Map<number, GatewayToolCall>()
    let usage: Record<string, unknown> | null = null
    let shouldContinue = false
    const isStreaming = providerRequest.stream === true

    if (!isStreaming) {
      const data = await resp.json() as Record<string, unknown>
      const choice = (data.choices as Array<Record<string, unknown>>)?.[0]
      const msg = choice?.message as Record<string, unknown> | undefined
      if (msg) {
        content = (msg.content as string) || ''
        reasoning = (msg.reasoning_content as string) || ''
        const rawToolCalls = msg.tool_calls as Array<Record<string, unknown>> | undefined
        if (rawToolCalls) {
          for (const tc of rawToolCalls) {
            const fn = tc.function as Record<string, unknown> | undefined
            toolCalls.set(tc.index as number, {
              id: (tc.id as string) || '',
              type: 'function',
              function: { name: (fn?.name as string) || '', arguments: (fn?.arguments as string) || '' },
            })
          }
        }
      }
      if (data.usage) usage = data.usage as Record<string, unknown>
      const finishReason = choice?.finish_reason as string | undefined
      console.log(`[AgenticLoop] Round ${round}: finish_reason=${finishReason}, tool_calls=${toolCalls.size}`)

      if (finishReason === 'tool_calls') {
        const allToolCalls = Array.from(toolCalls.values())
        const gatewayCalls = allToolCalls.filter((tc) => isGatewayTool(tc.function.name))
        const nativeCalls = allToolCalls.filter((tc) => isNativeTool(tc.function.name))
        const functionCalls = allToolCalls.filter((tc) => !isGatewayTool(tc.function.name) && !isNativeTool(tc.function.name))

        // Execute gateway tools in parallel
        if (gatewayCalls.length > 0) {
          const results = await Promise.all(gatewayCalls.map((tc) => executeGatewayTool(tc)))
          messages.push({ role: 'assistant', content: content || null, reasoning_content: reasoning || null, tool_calls: allToolCalls })
          for (let i = 0; i < gatewayCalls.length; i++) {
            messages.push({ role: 'tool', tool_call_id: gatewayCalls[i].id, content: results[i] })
          }
          shouldContinue = true
        }

        // Bounce native tools (Kimi $web_search, MiMo web_search)
        if (nativeCalls.length > 0) {
          console.log(`[AgenticLoop] Bouncing ${nativeCalls.length} native tool(s)`)
          messages.push({ role: 'assistant', content: content || null, reasoning_content: reasoning || null, tool_calls: allToolCalls })
          for (const tc of nativeCalls) {
            messages.push({ role: 'tool', tool_call_id: tc.id, content: '' })
          }
          shouldContinue = true
        }

        // Function tools: return to client
        if (functionCalls.length > 0) {
          console.log(`[AgenticLoop] Returning ${functionCalls.length} function tool(s) to client`)
          return {
            fullContent: content,
            fullReasoning: reasoning,
            usage,
            toolCalls: functionCalls,
          }
        }
      }
    } else {
      if (!resp.body) throw new Error('Provider returned empty body')
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let reasoningSent = false
      let messageSent = false

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

          // Emit SSE events to client
          if (stream) {
            if (delta?.reasoning_content) {
              if (!reasoningSent) {
                reasoningSent = true
                await stream.writeSSE({ event: 'response.output_item.added', data: JSON.stringify({ type: 'response.output_item.added', response_id: responseId, output_index: 0, item: { type: 'reasoning', id: `rs_${responseId}`, status: 'in_progress', summary: [] } }) })
              }
              await stream.writeSSE({ event: 'response.reasoning_summary_text.delta', data: JSON.stringify({ type: 'response.reasoning_summary_text.delta', response_id: responseId, item_id: `rs_${responseId}`, output_index: 0, content_index: 0, delta: delta.reasoning_content }) })
            }
            if (delta?.content) {
              if (!messageSent) {
                if (reasoningSent) {
                  await stream.writeSSE({ event: 'response.output_item.done', data: JSON.stringify({ type: 'response.output_item.done', response_id: responseId, output_index: 0, item: { type: 'reasoning', id: `rs_${responseId}`, status: 'completed', summary: [{ type: 'summary_text', text: reasoning }] } }) })
                }
                messageSent = true
                await stream.writeSSE({ event: 'response.output_item.added', data: JSON.stringify({ type: 'response.output_item.added', response_id: responseId, output_index: reasoningSent ? 1 : 0, item: { type: 'message', id: `msg_${responseId}`, status: 'in_progress', role: 'assistant', content: [] } }) })
              }
              await stream.writeSSE({ event: 'response.output_text.delta', data: JSON.stringify({ type: 'response.output_text.delta', response_id: responseId, item_id: `msg_${responseId}`, output_index: reasoningSent ? 1 : 0, content_index: 0, delta: delta.content }) })
            }
          }

          if (finishReason === 'tool_calls') {
            const allToolCalls = Array.from(toolCalls.values())
            const gatewayCalls = allToolCalls.filter((tc) => isGatewayTool(tc.function.name))
            const nativeCalls = allToolCalls.filter((tc) => isNativeTool(tc.function.name))
            const functionCalls = allToolCalls.filter((tc) => !isGatewayTool(tc.function.name) && !isNativeTool(tc.function.name))

            // Execute gateway tools
            if (gatewayCalls.length > 0) {
              const results = await Promise.all(gatewayCalls.map((tc) => executeGatewayTool(tc)))
              messages.push({ role: 'assistant', content: content || null, reasoning_content: reasoning || null, tool_calls: allToolCalls })
              for (let i = 0; i < gatewayCalls.length; i++) {
                messages.push({ role: 'tool', tool_call_id: gatewayCalls[i].id, content: results[i] })
              }
              shouldContinue = true
            }

            // Bounce native tools
            if (nativeCalls.length > 0) {
              console.log(`[AgenticLoop] Bouncing ${nativeCalls.length} native tool(s)`)
              messages.push({ role: 'assistant', content: content || null, reasoning_content: reasoning || null, tool_calls: allToolCalls })
              for (const tc of nativeCalls) {
                messages.push({ role: 'tool', tool_call_id: tc.id, content: '' })
              }
              shouldContinue = true
            }

            // Function tools: emit tool_call events and return
            if (functionCalls.length > 0 && stream) {
              console.log(`[AgenticLoop] Emitting ${functionCalls.length} function tool(s) to client`)
              // Finalize current message if any
              if (messageSent) {
                await stream.writeSSE({ event: 'response.output_item.done', data: JSON.stringify({ type: 'response.output_item.done', response_id: responseId, output_index: reasoningSent ? 1 : 0, item: { type: 'message', id: `msg_${responseId}`, status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: content }] } }) })
              }
              // Emit function tool calls
              for (const tc of functionCalls) {
                await stream.writeSSE({ event: 'response.output_item.added', data: JSON.stringify({ type: 'response.output_item.added', response_id: responseId, output_index: reasoningSent ? 2 : 1, item: { type: 'function_call', id: tc.id, name: tc.function.name, arguments: tc.function.arguments, status: 'in_progress' } }) })
                await stream.writeSSE({ event: 'response.output_item.done', data: JSON.stringify({ type: 'response.output_item.done', response_id: responseId, output_index: reasoningSent ? 2 : 1, item: { type: 'function_call', id: tc.id, name: tc.function.name, arguments: tc.function.arguments, status: 'completed' } }) })
              }
              return { fullContent: content, fullReasoning: reasoning, usage, toolCalls: functionCalls }
            }

            if (shouldContinue) break
          }
        }
        if (shouldContinue) break
      }
    }

    if (!shouldContinue) {
      fullContent = content
      fullReasoning = reasoning
      lastUsage = usage
      break
    }
  }

  // If we exhausted rounds without a text response, force one final request without tools
  if (!fullContent && messages.length > 0) {
    console.log(`[AgenticLoop] Forcing final response (no tools)`)
    const finalRequest = { ...providerRequest, tools: undefined, stream: false }
    const resp = await fetch(providerUrl, {
      method: 'POST',
      headers: providerHeaders,
      body: JSON.stringify(finalRequest),
    })
    if (resp.ok) {
      const data = await resp.json() as Record<string, unknown>
      const msg = (data.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown> | undefined
      if (msg) {
        fullContent = (msg.content as string) || ''
        fullReasoning = (msg.reasoning_content as string) || ''
      }
      if (data.usage) lastUsage = data.usage as Record<string, unknown>
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
  let messages: ChatMessage[] = []
  const existingItems = getConversationItems(conversationId) as ConversationItem[]
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

  // Resolve provider from model name
  const { name: providerName, config: providerConfig } = resolveProvider(body.model)
  console.log(`[Responses] model=${body.model} provider=${providerName}`)

  // Build provider-specific request
  if (config.debug && body.tools) {
    console.log(`[Responses] Input tools count: ${body.tools.length}`)
    // Save full request for debugging
    const fs = await import('fs')
    fs.writeFileSync('/tmp/llm_proxy_request.json', JSON.stringify(body, null, 2))
  }

  // Convert Responses API tools format to Chat Completions format
  // Responses: { type, name, description, parameters }
  // Chat Completions: { type, function: { name, description, parameters } }
  // Also filter out non-function tools (namespace, etc.) that providers don't understand
  const convertedTools = body.tools
    ?.filter((t: Record<string, unknown>) => t.type === 'function' || t.type === 'web_search' || t.type === 'web_fetch')
    .map((t: Record<string, unknown>) => {
      if (t.type === 'function' && t.name && !t.function) {
        return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters, strict: t.strict } }
      }
      return t
    })

  if (config.debug && convertedTools) {
    console.log(`[Responses] Converted tools: ${JSON.stringify(convertedTools).slice(0, 800)}`)
  }

  const requestOptions = {
    stream: body.stream,
    tools: convertedTools,
    tool_choice: body.tool_choice,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
  }

  let providerRequest: Record<string, unknown>
  switch (providerName) {
    case 'kimi':
      providerRequest = buildKimiRequest(providerConfig, messages, requestOptions)
      break
    case 'minimax':
      providerRequest = buildMiniMaxRequest(providerConfig, messages, requestOptions)
      break
    case 'mimo':
      providerRequest = buildMiMoRequest(providerConfig, messages, requestOptions)
      break
    default:
      providerRequest = buildProviderRequest(providerConfig, messages, requestOptions)
  }

  // Gateway tool injection: replace web_search and web_fetch with virtual functions
  const hasSearchTool = body.tools?.some((t: { type?: string }) => t.type === 'web_search') ?? false
  const hasFetchTool = body.tools?.some((t: { type?: string }) => t.type === 'web_fetch') ?? false
  const hasGatewayTools = hasSearchTool || hasFetchTool

  if (hasGatewayTools) {
    const gatewayTools: Array<Record<string, unknown>> = []

    if (hasSearchTool) {
      gatewayTools.push({
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
      })
    }

    if (hasFetchTool) {
      gatewayTools.push({
        type: 'function',
        function: {
          name: '_gateway_web_fetch',
          description: 'Fetch and extract content from a URL',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'The URL to fetch' },
            },
            required: ['url'],
          },
        },
      })
    }

    providerRequest.tools = [
      ...(providerRequest.tools || []).filter((t: { type?: string }) => t.type !== 'web_search' && t.type !== 'web_fetch'),
      ...gatewayTools,
    ]
  }

  // Non-streaming
  if (!body.stream) {
    try {
      // Use agentic loop when web search tools are present
      if (hasGatewayTools) {
        const result = await agenticLoop(messages, providerRequest, providerConfig, responseId, hasGatewayTools)
        let outputParsed = null
        if (body.text?.format?.type === 'json_schema' && result.fullContent) {
          const { parsed } = tryParseJson(result.fullContent)
          outputParsed = parsed
        }

        // Build output items
        const output: Array<Record<string, unknown>> = []
        if (result.fullContent) {
          output.push({
            type: 'message',
            id: `msg_${randomUUID().slice(0, 12)}`,
            role: 'assistant',
            content: [{ type: 'output_text', text: result.fullContent }],
            status: 'completed',
          })
        }
        // Add function_call output items for client-side tools
        if (result.toolCalls) {
          for (const tc of result.toolCalls) {
            output.push({
              type: 'function_call',
              id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
              status: 'completed',
            })
          }
        }

        const response: ResponsesResponse = {
          id: responseId,
          object: 'response',
          conversation_id: conversationId,
          status: 'completed',
          output,
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
      const resp = await fetch(getProviderUrl(providerConfig), {
        method: 'POST',
        headers: getProviderHeaders(providerConfig),
        body: JSON.stringify(providerRequest),
      })
      if (!resp.ok) {
        return c.json({ error: { message: await resp.text(), code: resp.status } }, resp.status)
      }
      const data = await resp.json() as Record<string, unknown>
      const choice = (data.choices as Array<Record<string, unknown>>)?.[0]
      const msg = choice?.message as Record<string, unknown> | undefined
      let outputParsed = null
      if (body.text?.format?.type === 'json_schema' && msg?.content) {
        const { parsed } = tryParseJson(msg.content)
        outputParsed = parsed
      }
      const response: ResponsesResponse = {
        id: responseId,
        object: 'response',
        conversation_id: conversationId,
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: { message, type: 'internal_error' } }, 500)
    }
  }

  // Streaming
  try {
    // Use agentic loop when web search tools are present
    if (hasGatewayTools) {
      return streamSSE(c, async (stream) => {
        let aborted = false
        stream.onAbort(() => { aborted = true })

        try {
          // Emit response.created
          await stream.writeSSE({
            event: 'response.created',
            data: JSON.stringify({
              type: 'response.created',
              response: { id: responseId, object: 'response', status: 'in_progress', output: [] },
            }),
          })

          const result = await agenticLoop(messages, providerRequest, providerConfig, responseId, hasGatewayTools, stream)

          // Finalize: message done (skip if tool calls were returned — already emitted)
          if (!result.toolCalls && (result.fullContent || result.fullReasoning)) {
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

          // Save to DB (only when we have text output, not tool calls)
          if (!result.toolCalls && (result.fullContent || result.fullReasoning)) {
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

      // Emit response.created
      await stream.writeSSE({
        event: 'response.created',
        data: JSON.stringify({
          type: 'response.created',
          response: { id: responseId, object: 'response', status: 'in_progress', output: [] },
        }),
      })

      const upstreamResp = await fetch(getProviderUrl(providerConfig), {
        method: 'POST',
        headers: getProviderHeaders(providerConfig),
        body: JSON.stringify(providerRequest),
      })
      if (!upstreamResp.ok) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: { message: await upstreamResp.text(), code: upstreamResp.status } }),
        })
        return
      }

      if (!upstreamResp.body) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: { message: 'Provider returned empty body', type: 'internal_error' } }),
        })
        return
      }
      const reader = upstreamResp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let reasoningSent = false
      let messageSent = false
      let fullReasoning = ''
      let fullContent = ''
      let lastUsage: Record<string, unknown> | null = null
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
          if (reasoningSent && delta.content && !messageSent) {
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: { message, type: 'internal_error' } }, 500)
  }
})
