import { createServer } from 'node:http'
import { createLimiter } from './rate-limit.mjs'

const port = Number(process.env.PORT || 8787)
const upstream = process.env.UPSTREAM_URL || 'https://apihub.agnes-ai.com/v1/chat/completions'
const apiKey = (process.env.AGNES_API_KEY || '').trim()
const proxyToken = (process.env.PROXY_TOKEN || '').trim()
const limit = Number(process.env.RATE_LIMIT || 30)
const limiter = createLimiter({ limit, windowMs: 60_000 })

if (!apiKey) {
  console.error('AGNES_API_KEY is required in the relay environment.')
  process.exit(1)
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ ok: true }))
    return
  }
  if (request.method !== 'POST' || !request.url || !request.url.startsWith('/v1/chat/completions')) {
    response.writeHead(404, { 'Content-Type': 'text/plain' })
    response.end('Not found')
    return
  }
  if (proxyToken) {
    const header = request.headers.authorization || ''
    if (header !== `Bearer ${proxyToken}`) {
      response.writeHead(401, { 'Content-Type': 'text/plain' })
      response.end('Unauthorized')
      return
    }
  }
  const ip = request.socket.remoteAddress || 'unknown'
  if (!limiter.allow(ip)) {
    response.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '60' })
    response.end('Too many requests')
    return
  }
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  let body = Buffer.concat(chunks).toString('utf8')
  if (process.env.MODEL) {
    try {
      const json = JSON.parse(body)
      json.model = process.env.MODEL
      body = JSON.stringify(json)
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain' })
      response.end('Expected JSON')
      return
    }
  }
  try {
    const upstreamResponse = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body
    })
    const text = await upstreamResponse.text()
    response.writeHead(upstreamResponse.status, { 'Content-Type': 'application/json' })
    response.end(text)
  } catch {
    response.writeHead(502, { 'Content-Type': 'text/plain' })
    response.end('Relay failed')
  }
})

server.listen(port, () => {
  console.log(`Chat relay listening on ${port}`)
})
