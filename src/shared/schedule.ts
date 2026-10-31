import type { ChatMessage } from './types'
import { delayRangeMs } from './speed'

export interface ScheduledMessage {
  at: number
  message: ChatMessage
}

function randBetween(min: number, max: number, rng: () => number): number {
  const t = Math.min(1, Math.max(0, rng()))
  return Math.round(min + (max - min) * t)
}

export function scheduleMessages(
  messages: ChatMessage[],
  speedLevel: number,
  now: number,
  rng: () => number = Math.random
): ScheduledMessage[] {
  const [min, max] = delayRangeMs(speedLevel)
  let cursor = now + randBetween(90, 320, rng)
  const scheduled: ScheduledMessage[] = []
  for (const message of messages) {
    scheduled.push({ at: cursor, message })
    cursor += randBetween(min, max, rng)
  }
  return scheduled
}

export function coverInterval(items: ScheduledMessage[], now: number, intervalMs: number): ScheduledMessage[] {
  if (items.length <= 1 || intervalMs <= 0) return items
  const start = Math.max(items[0]?.at ?? now, now + 150)
  const cover = now + Math.round(intervalMs * 0.85)
  const end = items[items.length - 1]?.at ?? start
  if (end >= cover) return items
  const step = (cover - start) / Math.max(1, items.length - 1)
  return items.map((item, index) => ({ ...item, at: Math.round(start + index * step) }))
}

export function takeDue(
  queue: readonly ScheduledMessage[],
  now: number
): { next: ScheduledMessage | null; rest: ScheduledMessage[] } {
  if (queue.length === 0) return { next: null, rest: [] }
  const sorted = [...queue].sort((a, b) => a.at - b.at)
  if (sorted[0].at > now) return { next: null, rest: sorted }
  const [next, ...rest] = sorted
  let bump = 0
  const adjusted = rest.map((item) => {
    if (item.at > now) return item
    bump += 1
    return { ...item, at: now + bump * 140 }
  })
  return { next, rest: adjusted }
}
