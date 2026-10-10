// Starts the server. Everything it serves is in app.ts, which tests drive directly.
import { serve } from '@hono/node-server'
import { app, purgeTrash } from './app.ts'

purgeTrash()
setInterval(purgeTrash, 12 * 3_600_000).unref()

const port = Number(process.env.PORT ?? 5174)
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' }, () => {
  console.log(`Deskwork API on http://localhost:${port}`)
})
