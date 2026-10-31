import { colorFor } from './color'
import { makeId } from './ids'
import type { ChatMessage } from './types'
import { makeUsername } from './usernames'

const AMOUNTS = ['$2', '$3', '$5', '$10', '$20']
const NOTES = ['you carried that', 'for the clip', 'get a snack', 'that was worth it', 'keep going']
const VIEWERS = [12, 28, 47, 86, 140, 233, 64]
const MONTHS = [1, 2, 3, 6, 12]

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

export function maybeLocalEvent(rng: () => number, avoid: Set<string>, now = Date.now()): ChatMessage | null {
  if (rng() > 0.16) return null
  const username = makeUsername(rng, avoid)
  avoid.add(username.toLowerCase())
  const roll = rng()
  const base = {
    id: makeId(now, rng),
    username,
    badge: null,
    color: colorFor(username)
  }
  if (roll < 0.35) {
    return { ...base, kind: 'donation', amount: pick(AMOUNTS, rng), text: pick(NOTES, rng) }
  }
  if (roll < 0.6) {
    const months = pick(MONTHS, rng)
    const text = months === 1 ? 'subscribed' : `subscribed for ${months} months`
    return { ...base, kind: 'sub', badge: 'sub', text }
  }
  if (roll < 0.82) {
    return { ...base, kind: 'raid', viewers: pick(VIEWERS, rng), text: 'incoming raid' }
  }
  const level = 1 + Math.floor(rng() * 3)
  return {
    ...base,
    kind: 'hype',
    hypeLevel: level,
    hypeProgress: 20 + Math.floor(rng() * 75),
    text: `hype train level ${level}`
  }
}
