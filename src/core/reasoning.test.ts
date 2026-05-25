import { describe, it, expect } from 'bun:test'
import { ReasoningStateMachine } from './reasoning'

describe('ReasoningStateMachine', () => {
  it('starts in IDLE state', () => {
    const sm = new ReasoningStateMachine('resp_1')
    expect(sm.getState()).toBe('IDLE')
  })

  it('transitions to REASONING when reasoning_content arrives', () => {
    const sm = new ReasoningStateMachine('resp_1')
    const { events } = sm.processChunk({ reasoning_content: 'Let me think' })
    expect(sm.getState()).toBe('REASONING')
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('response.output_item.added')
    expect(events[0].data.item.type).toBe('reasoning')
  })

  it('transitions to TEXT when content arrives after reasoning', () => {
    const sm = new ReasoningStateMachine('resp_1')
    sm.processChunk({ reasoning_content: 'thinking...' })
    const { events } = sm.processChunk({ content: 'The answer' })
    expect(sm.getState()).toBe('TEXT')
    // Should have: reasoning done + message added + text delta = 3 events
    expect(events).toHaveLength(3)
    expect(events[0].event).toBe('response.output_item.done')
    expect(events[0].data.item.type).toBe('reasoning')
    expect(events[1].event).toBe('response.output_item.added')
    expect(events[1].data.item.type).toBe('message')
    expect(events[2].event).toBe('response.output_text.delta')
    expect(events[2].data.delta).toBe('The answer')
  })

  it('transitions directly to TEXT when content arrives without reasoning', () => {
    const sm = new ReasoningStateMachine('resp_1')
    const { events } = sm.processChunk({ content: 'Hello!' })
    expect(sm.getState()).toBe('TEXT')
    expect(events).toHaveLength(2)
    expect(events[0].event).toBe('response.output_item.added')
    expect(events[0].data.item.type).toBe('message')
    expect(events[1].event).toBe('response.output_text.delta')
    expect(events[1].data.delta).toBe('Hello!')
  })

  it('accumulates reasoning text across multiple chunks', () => {
    const sm = new ReasoningStateMachine('resp_1')
    sm.processChunk({ reasoning_content: 'step 1. ' }) // IDLE->REASONING (text not accumulated in transition)
    sm.processChunk({ reasoning_content: 'step 2. ' })
    sm.processChunk({ reasoning_content: 'step 3.' })
    // First chunk triggers transition only; text is accumulated from subsequent REASONING-state chunks
    expect(sm.getReasoningText()).toBe('step 2. step 3.')
    expect(sm.getState()).toBe('REASONING')
  })

  it('accumulates content text across multiple chunks', () => {
    const sm = new ReasoningStateMachine('resp_1')
    sm.processChunk({ content: 'Hello' })
    sm.processChunk({ content: ' world' })
    sm.processChunk({ content: '!' })
    expect(sm.getContentText()).toBe('Hello world!')
  })

  it('handles reasoning_details (MiniMax array format) - transitions to REASONING', () => {
    const sm = new ReasoningStateMachine('resp_1')
    const { events } = sm.processChunk({
      reasoning_details: [{ text: 'analyzing...' }],
    })
    expect(sm.getState()).toBe('REASONING')
    // First chunk in IDLE transitions state but emits item.added, not delta
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('response.output_item.added')
    expect(events[0].data.item.type).toBe('reasoning')
  })

  it('processes reasoning_details content in REASONING state', () => {
    const sm = new ReasoningStateMachine('resp_1')
    sm.processChunk({ reasoning_content: 'init' }) // transition IDLE->REASONING
    const { events } = sm.processChunk({
      reasoning_details: [{ text: 'analyzing...' }],
    })
    expect(sm.getReasoningText()).toBe('analyzing...')
    expect(events[0].event).toBe('response.reasoning_summary_text.delta')
  })

  it('handles reasoning_details with multiple entries in REASONING state', () => {
    const sm = new ReasoningStateMachine('resp_1')
    sm.processChunk({ reasoning_content: 'init' }) // transition IDLE->REASONING
    sm.processChunk({
      reasoning_details: [{ text: 'part 1' }, { text: ' part 2' }],
    })
    expect(sm.getReasoningText()).toBe('part 1 part 2')
  })

  it('handles reasoning-only response (no content)', () => {
    const sm = new ReasoningStateMachine('resp_1')
    sm.processChunk({ reasoning_content: 'thinking...' })
    const { events } = sm.finish()
    // Should have: reasoning done + message added + message done + completed = 4 events
    expect(events).toHaveLength(4)
    expect(events[0].event).toBe('response.output_item.done')
    expect(events[0].data.item.type).toBe('reasoning')
    expect(events[1].event).toBe('response.output_item.added')
    expect(events[1].data.item.type).toBe('message')
    expect(events[2].event).toBe('response.output_item.done')
    expect(events[2].data.item.type).toBe('message')
    expect(events[2].data.item.content).toEqual([{ type: 'output_text', text: '' }])
    expect(events[3].event).toBe('response.completed')
  })

  it('handles content-only response (no reasoning)', () => {
    const sm = new ReasoningStateMachine('resp_1')
    sm.processChunk({ content: 'Hello' })
    const { events } = sm.finish()
    // Should have: message done + completed = 2 events
    expect(events).toHaveLength(2)
    expect(events[0].event).toBe('response.output_item.done')
    expect(events[0].data.item.type).toBe('message')
    expect(events[0].data.item.content).toEqual([{ type: 'output_text', text: 'Hello' }])
    expect(events[1].event).toBe('response.completed')
  })

  it('finish emits completed event with usage', () => {
    const sm = new ReasoningStateMachine('resp_1')
    sm.processChunk({ content: 'test' })
    const { events } = sm.finish({ input_tokens: 10, output_tokens: 5, total_tokens: 15 })
    const completedEvent = events.find(e => e.event === 'response.completed')
    expect(completedEvent).toBeDefined()
    expect(completedEvent!.data.usage).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 })
  })

  it('finish on IDLE only emits completed', () => {
    const sm = new ReasoningStateMachine('resp_1')
    const { events } = sm.finish()
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('response.completed')
  })

  it('state moves to DONE after finish', () => {
    const sm = new ReasoningStateMachine('resp_1')
    sm.processChunk({ content: 'test' })
    sm.finish()
    expect(sm.getState()).toBe('DONE')
  })
})
