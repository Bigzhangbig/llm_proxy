import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'test', // not used by proxy
})

async function testMiMo() {
  console.log('=== MiMo Non-streaming ===')
  const response = await client.responses.create({
    model: 'mimo-v2.5-pro',
    input: '1+1等于多少？',
    stream: false,
  })
  console.log('Status:', response.status)
  console.log('Output:', response.output?.[0]?.content?.[0]?.text)
  console.log()
}

async function testMiMoStream() {
  console.log('=== MiMo Streaming ===')
  const stream = await client.responses.create({
    model: 'mimo-v2.5-pro',
    input: '用一句话解释量子计算',
    stream: true,
  })

  for await (const event of stream) {
    if (event.type === 'response.reasoning_summary_text.delta') {
      process.stdout.write(`[R]${event.delta}`)
    } else if (event.type === 'response.output_text.delta') {
      process.stdout.write(event.delta)
    } else if (event.type === 'response.completed') {
      console.log('\n[DONE]', JSON.stringify(event.usage))
    }
  }
  console.log()
}

async function testMiMoMultiTurn() {
  console.log('=== MiMo Multi-turn ===')
  const resp1 = await client.responses.create({
    model: 'mimo-v2.5-pro',
    input: '我叫小明',
    stream: false,
  })
  console.log('Turn 1:', resp1.output?.[0]?.content?.[0]?.text)
  console.log('conversation_id:', (resp1 as any).conversation_id)

  const convId = (resp1 as any).conversation_id
  const resp2 = await client.responses.create({
    model: 'mimo-v2.5-pro',
    input: '我叫什么？',
    conversation: convId,
    stream: false,
  })
  console.log('Turn 2:', resp2.output?.[0]?.content?.[0]?.text)
  console.log()
}

async function main() {
  try {
    await testMiMo()
    await testMiMoStream()
    await testMiMoMultiTurn()
  } catch (err) {
    console.error('Error:', err)
  }
}

main()
