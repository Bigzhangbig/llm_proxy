import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { responsesRouter } from './routes/responses'
import { config } from './config'

const app = new Hono()

app.use(logger())
app.use(cors())

app.route('/v1', responsesRouter)

app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }))

console.log(`llm_proxy running on http://localhost:${config.port}`)

export default {
  port: config.port,
  fetch: app.fetch,
  idleTimeout: 120,
}
