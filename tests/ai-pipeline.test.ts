import { createServer, type Server } from 'node:http'
import { describe, expect, it } from 'vitest'
import { requestCompletion } from '../src/shared/ai-client'
import { produceReactions, type ProduceInput } from '../src/shared/pipeline'
import { nextBackoff, resolveCompletionsUrl } from '../src/shared/urls'
import { mulberry32 } from './rng'

function input(overrides: Partial<ProduceInput> = {}): ProduceInput {
  return {
    reason: 'interval',
    screenEnabled: true,
    capturePaused: false,
    voiceEnabled: true,
    proxyUrl: '',
    endpoint: 'https://service.example/v1/chat/completions',
    apiKey: 'baked-key',
    proxyToken: '',
    model: 'test-model',
    imageBase64: 'aGVsbG8=',
    transcripts: ['nice shot'],
    recentLines: ['pixel: hello'],
    avoidUsernames: ['pixel'],
    speedLevel: 4,
    now: 1_000_000,
    batchCount: 4,
    maxTokens: 280,
    backoffMs: 0,
    ...overrides
  }
}

const modelJson = JSON.stringify({
  messages: [
    { username: 'nova_fox', badge: 'sub', message: 'that was clean', color: '#ffd36e', kind: 'chat' },
    { username: 'moth_lane', badge: null, message: 'kill yourself', color: '#8eb6ff', kind: 'chat' },
    { username: 'cedar_pine', badge: null, message: 'menu moment?', color: '#7dffa8', kind: 'chat' }
  ]
})

describe('completions URL and backoff', () => {
  it('keeps a direct endpoint and appends the relay path once', () => {
    expect(resolveCompletionsUrl('', 'https://service.example/v1/chat/completions')).toBe(
      'https://service.example/v1/chat/completions'
    )
    expect(resolveCompletionsUrl('https://relay.example', 'https://service.example/v1/chat/completions')).toBe(
      'https://relay.example/v1/chat/completions'
    )
    expect(resolveCompletionsUrl('https://relay.example/v1/chat/completions', 'https://ignored.example')).toBe(
      'https://relay.example/v1/chat/completions'
    )
    expect(nextBackoff(0, true)).toBe(15000)
    expect(nextBackoff(15000, true)).toBe(30000)
    expect(nextBackoff(120000, true)).toBe(120000)
    expect(nextBackoff(15000, false)).toBe(0)
  })
})

describe('reaction pipeline', () => {
  it('schedules varied model messages and drops unsafe lines', async () => {
    const seen: { url: string; apiKey: string; image: string | null }[] = []
    const output = await produceReactions(input(), {
      rng: () => 0.5,
      complete: async (params) => {
        seen.push({ url: params.url, apiKey: params.apiKey, image: params.imageBase64 })
        return { ok: true, content: modelJson }
      }
    })
    expect(output.source).toBe('model')
    expect(output.analyzed).toBe(true)
    expect(seen[0]).toEqual({
      url: 'https://service.example/v1/chat/completions',
      apiKey: 'baked-key',
      image: 'aGVsbG8='
    })
    const texts = output.scheduled.map((item) => item.message.text)
    expect(texts).toContain('that was clean')
    expect(texts).toContain('menu moment?')
    expect(texts).not.toContain('kill yourself')
    const times = output.scheduled.map((item) => item.at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(new Set(times).size).toBe(times.length)
  })

  it('uses the relay token instead of the baked key', async () => {
    let auth = ''
    await produceReactions(input({ proxyUrl: 'https://relay.example/', proxyToken: 'relay-token' }), {
      rng: () => 0.5,
      complete: async (params) => {
        auth = `${params.url}|${params.apiKey}`
        return { ok: true, content: modelJson }
      }
    })
    expect(auth).toBe('https://relay.example/v1/chat/completions|relay-token')
    expect(auth).not.toContain('baked-key')
  })

  it('falls back and backs off when the service is rate limited', async () => {
    const output = await produceReactions(input(), {
      rng: mulberry32(4),
      complete: async () => ({ ok: false, reason: 'rate_limit', status: 429, retryAfterMs: 20000 })
    })
    expect(output.source).toBe('fallback')
    expect(output.nextBackoffMs).toBe(20000)
    expect(output.scheduled.length).toBeGreaterThan(0)
    expect(new Set(output.scheduled.map((item) => item.at)).size).toBe(output.scheduled.length)
  })

  it('does not call the service while capture is paused', async () => {
    let calls = 0
    const output = await produceReactions(input({ capturePaused: true }), {
      rng: mulberry32(1),
      complete: async () => {
        calls += 1
        return { ok: true, content: modelJson }
      }
    })
    expect(calls).toBe(0)
    expect(output.source).toBe('skipped')
  })

  it('answers from a transcript without an image', async () => {
    let sawImage: string | null = 'unset'
    const output = await produceReactions(
      input({ reason: 'voice', imageBase64: null, screenEnabled: false, transcripts: ['what was that'] }),
      {
        rng: () => 0.5,
        complete: async (params) => {
          sawImage = params.imageBase64
          expect(params.userText).toContain('what was that')
          expect(params.userText).toContain('Do not invent what is on the screen')
          expect(params.userText.toLowerCase()).not.toContain('screenshot')
          return { ok: true, content: modelJson }
        }
      }
    )
    expect(sawImage).toBeNull()
    expect(output.source).toBe('model')
    expect(output.analyzed).toBe(false)
  })

  it('adds computer audio to the same request', async () => {
    let calls = 0
    let text = ''
    await produceReactions(input({ pcAudio: ['the boss yelled'] }), {
      rng: () => 0.5,
      complete: async (params) => {
        calls += 1
        text = params.userText
        return { ok: true, content: modelJson }
      }
    })
    expect(calls).toBe(1)
    expect(text).toContain('Audio on the PC')
    expect(text).toContain('the boss yelled')
  })
})

describe('chat endpoint', () => {
  it('sends the image, retries without a JSON mode flag, and hides the key on failure', async () => {
    const bodies: string[] = []
    const auths: string[] = []
    const server = await listen((request, response) => {
      auths.push(request.headers.authorization ?? '')
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(chunk as Buffer))
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        bodies.push(body)
        if (body.includes('response_format')) {
          response.writeHead(400, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ error: { message: 'unsupported format' } }))
          return
        }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content: modelJson } }] }))
      })
    })
    const result = await requestCompletion({
      url: server.url,
      apiKey: 'secret-key-value',
      model: 'test-model',
      system: 'json only',
      userText: 'react',
      imageBase64: 'aGVsbG8='
    })
    await server.close()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content).toContain('nova_fox')
    expect(auths.every((header) => header === 'Bearer secret-key-value')).toBe(true)
    expect(bodies[0]).toContain('response_format')
    expect(bodies[1]).not.toContain('response_format')
    expect(bodies[1]).toContain('data:image/jpeg;base64,aGVsbG8=')
    expect(JSON.stringify(result)).not.toContain('secret-key-value')
  })

  it('reports rate limits without echoing credentials', async () => {
    const server = await listen((_request, response) => {
      response.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '9' })
      response.end(JSON.stringify({ error: { message: 'rate limit', key: 'secret-key-value' } }))
    })
    const result = await requestCompletion({
      url: server.url,
      apiKey: 'secret-key-value',
      model: 'test-model',
      system: 'json only',
      userText: 'react',
      imageBase64: null
    })
    await server.close()
    expect(result).toMatchObject({ ok: false, reason: 'rate_limit', retryAfterMs: 9000 })
    expect(JSON.stringify(result)).not.toContain('secret-key-value')
  })
})

function listen(
  handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(handler)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('no port'))
        return
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/v1/chat/completions`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()))
          })
      })
    })
  })
}
