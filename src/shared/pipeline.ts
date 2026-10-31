import type { CompletionParams, CompletionResult } from './ai-client'
import { maybeLocalEvent } from './events'
import { isKidSafe } from './filter'
import { makeFallbackMessages } from './fallback'
import { parseModelOutput } from './parser'
import { buildSystemPrompt, buildUserText } from './prompt'
import { scheduleMessages, type ScheduledMessage } from './schedule'
import type { ChatMessage } from './types'
import { resolveCompletionsUrl, nextBackoff } from './urls'
import { usableProxyUrl } from './settings'

export interface ProduceInput {
  reason: 'interval' | 'voice'
  screenEnabled: boolean
  capturePaused: boolean
  voiceEnabled: boolean
  proxyUrl: string
  endpoint: string
  apiKey: string
  proxyToken: string
  model: string
  imageBase64: string | null
  transcripts: string[]
  recentLines: string[]
  avoidUsernames: string[]
  speedLevel: number
  now: number
  batchCount: number
  maxTokens: number
  backoffMs: number
}

export interface ProduceOutput {
  scheduled: ScheduledMessage[]
  nextBackoffMs: number
  source: 'model' | 'fallback' | 'skipped'
  analyzed: boolean
}

export interface ProduceDeps {
  rng: () => number
  complete: (params: CompletionParams) => Promise<CompletionResult>
}

function fallbackBatch(input: ProduceInput, deps: ProduceDeps, count: number): ChatMessage[] {
  const avoid = new Set(input.avoidUsernames.map((name) => name.toLowerCase()))
  const hint = input.transcripts[input.transcripts.length - 1]
  const messages = makeFallbackMessages(count, deps.rng, avoid, hint)
  const event = maybeLocalEvent(deps.rng, avoid, input.now)
  if (event && !messages.some((message) => message.kind !== 'chat')) messages.push(event)
  return messages.filter((message) => isKidSafe(message.text) && isKidSafe(message.username))
}

function keepSafe(messages: ChatMessage[], avoid: Set<string>, rng: () => number): ChatMessage[] {
  const safe: ChatMessage[] = []
  for (const message of messages) {
    if (!isKidSafe(message.text)) continue
    let username = message.username
    if (!isKidSafe(username)) {
      username = `viewer${Math.floor(rng() * 100000)}`
    }
    const key = username.toLowerCase()
    if (avoid.has(key)) continue
    avoid.add(key)
    safe.push({ ...message, username })
  }
  return safe
}

export async function produceReactions(input: ProduceInput, deps: ProduceDeps): Promise<ProduceOutput> {
  if (input.reason === 'interval' && (!input.screenEnabled || input.capturePaused)) {
    return { scheduled: [], nextBackoffMs: input.backoffMs, source: 'skipped', analyzed: false }
  }
  if (input.reason === 'voice' && (!input.voiceEnabled || input.transcripts.length === 0)) {
    return { scheduled: [], nextBackoffMs: input.backoffMs, source: 'skipped', analyzed: false }
  }

  const proxy = usableProxyUrl(input.proxyUrl)
  const directReady = Boolean(input.apiKey && input.model && input.endpoint)
  const ready = Boolean(proxy) || directReady
  const includeImage = Boolean(input.imageBase64) && input.screenEnabled && !input.capturePaused

  if (!ready || (input.reason === 'interval' && !input.imageBase64)) {
    const messages = fallbackBatch(input, deps, Math.max(3, input.batchCount))
    return {
      scheduled: scheduleMessages(messages, input.speedLevel, input.now, deps.rng),
      nextBackoffMs: input.backoffMs,
      source: 'fallback',
      analyzed: false
    }
  }

  const result = await deps.complete({
    url: resolveCompletionsUrl(proxy, input.endpoint),
    apiKey: proxy ? input.proxyToken : input.apiKey,
    model: input.model,
    system: buildSystemPrompt(),
    userText: buildUserText({
      transcripts: input.transcripts,
      recentLines: input.recentLines,
      avoidUsernames: input.avoidUsernames,
      batchCount: input.batchCount,
      hasImage: includeImage
    }),
    imageBase64: includeImage ? input.imageBase64 : null,
    maxTokens: input.maxTokens
  })

  if (!result.ok && result.reason === 'aborted') {
    return { scheduled: [], nextBackoffMs: input.backoffMs, source: 'skipped', analyzed: false }
  }

  if (!result.ok) {
    const failed = result.reason === 'rate_limit' || result.reason === 'unavailable'
    const messages = fallbackBatch(input, deps, Math.max(3, input.batchCount))
    return {
      scheduled: scheduleMessages(messages, input.speedLevel, input.now, deps.rng),
      nextBackoffMs: nextBackoff(input.backoffMs, failed, result.retryAfterMs),
      source: 'fallback',
      analyzed: includeImage
    }
  }

  const avoid = new Set(input.avoidUsernames.map((name) => name.toLowerCase()))
  const parsed = keepSafe(
    parseModelOutput(result.content, { now: input.now, rng: deps.rng, avoid: new Set(avoid) }),
    avoid,
    deps.rng
  )
  let messages = parsed
  if (messages.length === 0) {
    messages = fallbackBatch(input, deps, Math.max(3, input.batchCount))
    return {
      scheduled: scheduleMessages(messages, input.speedLevel, input.now, deps.rng),
      nextBackoffMs: 0,
      source: 'fallback',
      analyzed: includeImage
    }
  }
  if (!messages.some((message) => message.kind !== 'chat')) {
    const event = maybeLocalEvent(deps.rng, avoid, input.now)
    if (event && isKidSafe(event.text)) messages = [...messages, event]
  }
  return {
    scheduled: scheduleMessages(messages.slice(0, 10), input.speedLevel, input.now, deps.rng),
    nextBackoffMs: 0,
    source: 'model',
    analyzed: includeImage
  }
}
