import { colorFor } from './color'
import { isKidSafe } from './filter'
import { makeId } from './ids'
import type { Badge, ChatMessage } from './types'
import { makeUsername } from './usernames'

const POOLS: Record<string, string[]> = {
  hype: [
    'lets gooo',
    'THAT was clean',
    'W',
    'okay okay okay',
    'huge',
    'clutch',
    'we are so back',
    'absolute cinema',
    'lock in',
    'that was peak'
  ],
  troll: [
    'bold strategy',
    'chat we saw that',
    'interesting choice',
    'the vision is there',
    'huh',
    'skill issue but respectful',
    'menu merchant',
    'that was a choice'
  ],
  helpful: [
    'you got this',
    'save before the next fight',
    'watch the corner',
    'try the other route',
    'take the heal',
    'check the map',
    'slow it down a second'
  ],
  lurker: ['...', 'watching', 'hmm', 'ok', 'nice', 'still here', 'mm'],
  emote: ['😂😂', '🔥', '💀', '👏👏👏', '😭', '✨', '🎮', '❤️'],
  question: [
    'what is this game',
    'wait what happened',
    'are you speedrunning',
    'why did that hit',
    'is this a boss',
    'what are we looking at',
    'menu moment?'
  ],
  calm: [
    'nice',
    'oh no',
    'close one',
    'good fight',
    'that looked painful',
    'alright then',
    'fair enough',
    'smooth',
    'rough beat',
    'I see it'
  ],
  slang: [
    'lowkey cooked',
    'icl that was clean',
    'chat is this real',
    'aura loss',
    'let him cook',
    'six seven',
    'its giving clutch',
    'no cap that was close'
  ]
}

const FAIL = ['oh no', 'that looked painful', 'rip the run', 'unlucky', 'close enough', 'chat saw that']
const SPEECH_HYPE = ['LETS GO', 'huge if true', 'say it again', 'W speech', 'okay I heard that', 'we are so back']
const SPEECH_QUESTION = ['wait say that again', 'what do you mean', 'explain slower', 'I am listening', 'huh?']

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

export function createLineBag(lines: readonly string[], rng: () => number): { next: () => string } {
  let order: string[] = []
  let last = ''
  return {
    next() {
      if (order.length === 0) {
        order = [...lines]
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1))
          const swap = order[i]
          order[i] = order[j]
          order[j] = swap
        }
        const tail = order.length - 1
        if (tail > 0 && order[tail] === last) {
          const swapAt = Math.floor(rng() * tail)
          const swap = order[swapAt]
          order[swapAt] = order[tail]
          order[tail] = swap
        }
      }
      const line = order.pop() ?? lines[0]
      last = line
      return line
    }
  }
}

function badgeFor(rng: () => number): Badge {
  const roll = rng()
  if (roll < 0.04) return 'mod'
  if (roll < 0.1) return 'vip'
  if (roll < 0.25) return 'sub'
  return null
}

function poolForHint(hint: string | undefined, rng: () => number): string[] {
  if (hint) {
    const text = hint.toLowerCase()
    if (/\b(die|died|dead|fail|oops|no+|miss)\b/.test(text)) return FAIL
    if (/\b(win|won|yes|nice|clutch|gg|lets go|let's go)\b/.test(text)) return SPEECH_HYPE
    if (text.includes('?')) return SPEECH_QUESTION
  }
  if (rng() < 0.22) return POOLS.slang
  return pick(
    [POOLS.hype, POOLS.troll, POOLS.helpful, POOLS.lurker, POOLS.emote, POOLS.question, POOLS.calm],
    rng
  )
}

export function makeFallbackMessages(
  count: number,
  rng: () => number,
  avoid: Set<string>,
  hint?: string
): ChatMessage[] {
  const bag = createLineBag(poolForHint(hint, rng), rng)
  const messages: ChatMessage[] = []
  const seen = new Set<string>()
  for (let i = 0; i < count; i++) {
    let text = ''
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = bag.next()
      if (!seen.has(candidate) && isKidSafe(candidate)) {
        text = candidate
        seen.add(candidate)
        break
      }
    }
    if (!text) text = 'nice'
    const username = makeUsername(rng, avoid)
    avoid.add(username.toLowerCase())
    messages.push({
      id: makeId(Date.now() + i, rng),
      username,
      badge: badgeFor(rng),
      color: colorFor(username),
      text,
      kind: 'chat'
    })
  }
  return messages
}
