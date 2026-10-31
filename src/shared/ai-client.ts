import { extractAssistantText } from './response'
import { redact } from './redact'
import { retryAfterMs } from './urls'

export interface CompletionParams {
  url: string
  apiKey: string
  model: string
  system: string
  userText: string
  imageBase64: string | null
  maxTokens?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export type CompletionResult =
  | { ok: true; content: string }
  | { ok: false; reason: 'rate_limit' | 'unavailable' | 'aborted' | 'rejected_format'; status?: number; retryAfterMs?: number }

interface Attempt {
  ok: boolean
  status: number
  content: string | null
  retryAfterMs?: number
  aborted: boolean
  formatRejected: boolean
}

function userContent(userText: string, imageBase64: string | null): unknown {
  if (!imageBase64) return userText
  return [
    { type: 'text', text: userText },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
  ]
}

async function attempt(params: CompletionParams, withFormat: boolean): Promise<Attempt> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (params.apiKey) headers.Authorization = `Bearer ${params.apiKey}`
  const body: Record<string, unknown> = {
    model: params.model,
    temperature: 0.95,
    max_tokens: params.maxTokens ?? 320,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: userContent(params.userText, params.imageBase64) }
    ]
  }
  if (withFormat) body.response_format = { type: 'json_object' }
  const timeout = AbortSignal.timeout(params.timeoutMs ?? 25000)
  const signal = params.signal ? AbortSignal.any([params.signal, timeout]) : timeout
  const fetchImpl = params.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(params.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    })
    const retry = retryAfterMs(response.headers.get('retry-after'))
    const payload = (await response.json().catch(() => null)) as unknown
    if (response.status === 400 && withFormat) {
      return { ok: false, status: 400, content: null, aborted: false, formatRejected: true, retryAfterMs: retry }
    }
    if (!response.ok) {
      return { ok: false, status: response.status, content: null, aborted: false, formatRejected: false, retryAfterMs: retry }
    }
    return {
      ok: true,
      status: response.status,
      content: extractAssistantText(payload),
      aborted: false,
      formatRejected: false,
      retryAfterMs: retry
    }
  } catch (error) {
    const aborted = params.signal?.aborted === true
    return { ok: false, status: 0, content: null, aborted, formatRejected: false }
  }
}

export async function requestCompletion(params: CompletionParams): Promise<CompletionResult> {
  const first = await attempt(params, true)
  const chosen = first.formatRejected ? await attempt(params, false) : first
  if (chosen.aborted || params.signal?.aborted) return { ok: false, reason: 'aborted' }
  if (chosen.ok && chosen.content) return { ok: true, content: chosen.content }
  if (chosen.status === 429) {
    return { ok: false, reason: 'rate_limit', status: chosen.status, retryAfterMs: chosen.retryAfterMs }
  }
  return { ok: false, reason: 'unavailable', status: chosen.status || undefined }
}

export function safeErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : 'request failed'
  return redact(message).slice(0, 180)
}
