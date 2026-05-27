import { randomUUID } from 'crypto'

export type ReasoningState = 'IDLE' | 'REASONING' | 'TEXT' | 'DONE'

export class ReasoningStateMachine {
  private state: ReasoningState = 'IDLE'
  private reasoningText = ''
  private contentText = ''
  private itemId = ''
  private msgItemId = ''
  private responseId = ''

  constructor(responseId: string) {
    this.responseId = responseId
    this.itemId = `rs_${randomUUID().slice(0, 12)}`
    this.msgItemId = `msg_${randomUUID().slice(0, 12)}`
  }

  // Process a single SSE chunk, return events to emit
  processChunk(delta: Record<string, unknown>): { events: Array<{ event: string; data: Record<string, unknown> }> } {
    const events: Array<{ event: string; data: Record<string, unknown> }> = []

    if (this.state === 'IDLE') {
      // Check if reasoning starts
      if (delta.reasoning_content || (delta.reasoning_details && Array.isArray(delta.reasoning_details) && delta.reasoning_details.length > 0)) {
        this.state = 'REASONING'
        events.push({
          event: 'response.output_item.added',
          data: {
            type: 'response.output_item.added',
            response_id: this.responseId,
            output_index: 0,
            item: { type: 'reasoning', id: this.itemId, status: 'in_progress', summary: [] },
          },
        })
      } else if (delta.content) {
        this.state = 'TEXT'
        this.contentText += delta.content
        events.push({
          event: 'response.output_item.added',
          data: {
            type: 'response.output_item.added',
            response_id: this.responseId,
            output_index: 0,
            item: { type: 'message', id: this.msgItemId, status: 'in_progress', role: 'assistant', content: [] },
          },
        })
        events.push({
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            response_id: this.responseId,
            item_id: this.msgItemId,
            output_index: 0,
            content_index: 0,
            delta: delta.content,
          },
        })
      }
    } else if (this.state === 'REASONING') {
      if (delta.reasoning_content) {
        this.reasoningText += delta.reasoning_content
        events.push({
          event: 'response.reasoning_summary_text.delta',
          data: {
            type: 'response.reasoning_summary_text.delta',
            response_id: this.responseId,
            item_id: this.itemId,
            output_index: 0,
            content_index: 0,
            delta: delta.reasoning_content,
          },
        })
      } else if (delta.reasoning_details && (delta.reasoning_details as unknown[]).length > 0) {
        for (const detail of delta.reasoning_details as Array<Record<string, unknown>>) {
          if (detail.text) {
            this.reasoningText += detail.text
            events.push({
              event: 'response.reasoning_summary_text.delta',
              data: {
                type: 'response.reasoning_summary_text.delta',
                response_id: this.responseId,
                item_id: this.itemId,
                output_index: 0,
                content_index: 0,
                delta: detail.text,
              },
            })
          }
        }
      }

      // Check if reasoning ends and text begins
      if (delta.content) {
        events.push({
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            response_id: this.responseId,
            output_index: 0,
            item: {
              type: 'reasoning',
              id: this.itemId,
              status: 'completed',
              summary: [{ type: 'summary_text', text: this.reasoningText }],
            },
          },
        })

        this.state = 'TEXT'
        this.contentText += delta.content
        events.push({
          event: 'response.output_item.added',
          data: {
            type: 'response.output_item.added',
            response_id: this.responseId,
            output_index: 1,
            item: { type: 'message', id: this.msgItemId, status: 'in_progress', role: 'assistant', content: [] },
          },
        })
        events.push({
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            response_id: this.responseId,
            item_id: this.msgItemId,
            output_index: 1,
            content_index: 0,
            delta: delta.content,
          },
        })
      }
    } else if (this.state === 'TEXT') {
      if (delta.content) {
        this.contentText += delta.content
        events.push({
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            response_id: this.responseId,
            item_id: this.msgItemId,
            output_index: 1,
            content_index: 0,
            delta: delta.content,
          },
        })
      }
    }

    return { events }
  }

  // Finish: emit final done events
  finish(usage?: Record<string, unknown>): { events: Array<{ event: string; data: Record<string, unknown> }> } {
    const events: Array<{ event: string; data: Record<string, unknown> }> = []

    if (this.state === 'REASONING') {
      events.push({
        event: 'response.output_item.done',
        data: {
          type: 'response.output_item.done',
          response_id: this.responseId,
          output_index: 0,
          item: {
            type: 'reasoning',
            id: this.itemId,
            status: 'completed',
            summary: [{ type: 'summary_text', text: this.reasoningText }],
          },
        },
      })
    }

    if (this.state !== 'IDLE') {
      if (this.state === 'REASONING') {
        events.push({
          event: 'response.output_item.added',
          data: {
            type: 'response.output_item.added',
            response_id: this.responseId,
            output_index: 1,
            item: { type: 'message', id: this.msgItemId, status: 'in_progress', role: 'assistant', content: [] },
          },
        })
      }

      events.push({
        event: 'response.output_item.done',
        data: {
          type: 'response.output_item.done',
          response_id: this.responseId,
          output_index: 1,
          item: {
            type: 'message',
            id: this.msgItemId,
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: this.contentText }],
          },
        },
      })
    }

    events.push({
      event: 'response.completed',
      data: {
        type: 'response.completed',
        response_id: this.responseId,
        status: 'completed',
        usage: usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      },
    })

    this.state = 'DONE'
    return { events }
  }

  getState() { return this.state }
  getReasoningText() { return this.reasoningText }
  getContentText() { return this.contentText }
}
