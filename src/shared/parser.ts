import { colorFor } from './color'
import { isKidSafe } from './filter'
import { makeId } from './ids'
import type { Badge, ChatMessage, MessageKind } from './types'
import { makeUsername } from './usernames'

export interface ParseContext {
  now: number
  rng: () => number
  avoid: Set<string>
}

function extractJson(raw: string): unknown {
  let text = raw.trim().replace(/^\uFEFF/, '')
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  try {
    return JSON.parse(text) as unknown
  } catch {
    // Fall through to the first JSON-looking region.
  }
  const startObj = text.indexOf('{')
  const startArr = text.indexOf('[')
  const start =
    startObj === -1 ? startArr : startArr === -1 ? startObj : Math.min(startObj, startArr)
  if (start < 0) throw new Error('no json')
  const slice = text.slice(start)
  try {
    return JSON.parse(slice) as unknown
  } catch {
    const end = Math.max(slice.lastIndexOf('}'), slice.lastIndexOf(']'))
    if (end < 0) throw new Error('no json end')
    return JSON.parse(slice.slice(0, end + 1)) as unknown
  }
}

function unwrap(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return unwrap(JSON.parse(value) as unknown)
    } catch {
      return value
    }
  }
  return value
}

function findItems(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  for (const key of ['messages', 'chat', 'comments', 'viewers', 'items', 'data']) {
    if (Array.isArray(record[key])) return record[key]
  }
  if (typeof record.message === 'string' || typeof record.text === 'string') return [record]
  return null
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim().replace(/\s+/g, ' ')
  }
  return ''
}

function parseBadge(value: unknown): Badge {
  if (typeof value !== 'string') return null
  const badge = value.toLowerCase().trim()
  if (badge === 'mod' || badge === 'moderator') return 'mod'
  if (badge === 'sub' || badge === 'subscriber') return 'sub'
  if (badge === 'vip') return 'vip'
  return null
}

function parseKind(value: unknown): MessageKind {
  if (typeof value !== 'string') return 'chat'
  const kind = value.toLowerCase().trim()
  if (kind === 'donation' || kind === 'donate' || kind === 'superchat') return 'donation'
  if (kind === 'bits' || kind === 'cheer') return 'bits'
  if (kind === 'gift' || kind === 'subgift') return 'gift'
  if (kind === 'sub' || kind === 'subscription') return 'sub'
  if (kind === 'raid') return 'raid'
  if (kind === 'hype' || kind === 'hypetrain' || kind === 'hype_train') return 'hype'
  return 'chat'
}

function shortNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, Math.round(value)))
}

function sanitizeUsername(value: unknown, ctx: ParseContext): string {
  const raw = typeof value === 'string' ? value : ''
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 18)
  if (cleaned.length >= 3 && isKidSafe(cleaned) && !ctx.avoid.has(cleaned.toLowerCase())) {
    ctx.avoid.add(cleaned.toLowerCase())
    return cleaned
  }
  const generated = makeUsername(ctx.rng, ctx.avoid)
  ctx.avoid.add(generated.toLowerCase())
  return generated
}

function mapItem(item: unknown, ctx: ParseContext): ChatMessage | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const text = firstString(record.message, record.text, record.content).slice(0, 180)
  if (!text) return null
  const username = sanitizeUsername(record.username ?? record.name ?? record.user, ctx)
  const kind = parseKind(record.kind ?? record.type)
  const meta = record.meta && typeof record.meta === 'object' ? (record.meta as Record<string, unknown>) : {}
  const amount = firstString(record.amount, meta.amount).slice(0, 16)
  const message: ChatMessage = {
    id: makeId(ctx.now, ctx.rng),
    username,
    badge: parseBadge(record.badge),
    color: colorFor(username, typeof record.color === 'string' ? record.color : undefined),
    text,
    kind
  }
  if (kind === 'donation' && amount) message.amount = amount
  if (kind === 'raid') {
    const viewers = shortNumber(record.viewers ?? meta.viewers, 1, 100000)
    if (viewers) message.viewers = viewers
  }
  if (kind === 'hype') {
    const level = shortNumber(record.hypeLevel ?? record.level ?? meta.level, 1, 5)
    const progress = shortNumber(record.hypeProgress ?? record.progress ?? meta.progress, 1, 100)
    if (level) message.hypeLevel = level
    if (progress) message.hypeProgress = progress
  }
  return message
}

export function parseModelOutput(raw: string, ctx: ParseContext): ChatMessage[] {
  let parsed: unknown
  try {
    parsed = unwrap(extractJson(raw))
  } catch {
    return []
  }
  const items = findItems(parsed)
  if (!items) return []
  const messages: ChatMessage[] = []
  for (const item of items) {
    const message = mapItem(item, ctx)
    if (message) messages.push(message)
    if (messages.length >= 8) break
  }
  return messages
}
