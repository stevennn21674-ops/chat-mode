export const DEFAULT_MODEL = 'agnes-3.0-flash'
export const DEFAULT_BASE_URL = 'https://apihub.agnes-ai.com/v1'

export function completionsUrlFromBase(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (!trimmed) return completionsUrlFromBase(DEFAULT_BASE_URL)
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`
  return `${trimmed}/v1/chat/completions`
}

export function usableBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return DEFAULT_BASE_URL
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_BASE_URL
    return trimmed.replace(/\/+$/, '')
  } catch {
    return DEFAULT_BASE_URL
  }
}

export interface ResolvedService {
  apiKey: string
  model: string
  endpoint: string
  source: 'user' | 'fallback' | 'none'
}

export function resolveService(input: {
  userKey: string
  model: string
  baseUrl: string
  fallbackKey: string
}): ResolvedService {
  const model = input.model.trim() || DEFAULT_MODEL
  const endpoint = completionsUrlFromBase(usableBaseUrl(input.baseUrl))
  const userKey = input.userKey.trim()
  if (userKey) return { apiKey: userKey, model, endpoint, source: 'user' }
  const fallbackKey = input.fallbackKey.trim()
  if (fallbackKey) return { apiKey: fallbackKey, model, endpoint, source: 'fallback' }
  return { apiKey: '', model, endpoint, source: 'none' }
}
