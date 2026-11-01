import { colorFor } from './color'
import { BORED_LINES } from './crowd'
import { isKidSafe } from './filter'
import { makeId } from './ids'
import type { ScreenCue } from './screen-cues'
import type { Badge, ChatMessage } from './types'
import { makeUsername } from './usernames'

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'it', 'that', 'this', 'you',
  'we', 'im', 'its', 'was', 'be', 'are', 'was', 'just', 'like', 'with', 'have', 'has', 'but', 'not',
  'they', 'them', 'then', 'than', 'from', 'your', 'youre', 'gonna', 'gotta', 'dont', 'cant', 'wont'
])

const FRAGMENTS = [
  'yo', 'hey', 'ok', 'okay', 'wait', 'huh', 'hmm', 'nice', 'nah', 'yep', 'same', 'true', 'real',
  'bro', 'bestie', 'chat', 'hello', 'hi', 'wow', 'oh', 'ayy', 'bet', 'word', 'facts', 'mood',
  'sheesh', 'lets go', 'hold on', 'one sec', 'focus', 'chill', 'quiet', 'loud', 'again', 'please'
]

const EMOTES = ['😂', '🔥', '💀', '👏', '😭', '✨', '🎮', '❤️', '😮', '😎', '🎉', '⭐', '👀', '💯', '🫡', '🏆']

const HYPE = [
  'lets gooo', 'THAT was clean', 'huge', 'clutch', 'we are so back', 'absolute cinema', 'lock in',
  'that was peak', 'W', 'massive', 'goated play', 'clean win', 'so good', 'hype', 'run it back',
  'one more', 'dont stop', 'this is the run', 'certified moment', 'main character energy'
]

const ADJECTIVES = [
  'clean', 'slow', 'fast', 'loud', 'quiet', 'bright', 'dark', 'funny', 'weird', 'cool', 'chill',
  'wild', 'smooth', 'rough', 'tiny', 'huge', 'sneaky', 'brave', 'lucky', 'close', 'silly', 'cozy',
  'sharp', 'soft', 'gold', 'mid', 'peak', 'sleepy', 'hyper', 'calm', 'spicy', 'sweet', 'clever',
  'lost', 'found', 'shiny', 'dusty', 'bold', 'gentle', 'quick', 'late'
]

const NOUNS = [
  'clip', 'run', 'boss', 'menu', 'map', 'loot', 'door', 'bridge', 'cave', 'coin', 'chest', 'quest',
  'timer', 'score', 'round', 'team', 'plan', 'route', 'corner', 'jump', 'save', 'checkpoint', 'npc',
  'puzzle', 'key', 'gate', 'path', 'camp', 'boat', 'race', 'combo', 'streak', 'attempt', 'build',
  'loadout', 'zone', 'level', 'stage', 'item', 'hint', 'marker', 'chat'
]

const VERBS = [
  'clutched', 'missed', 'saved', 'found', 'opened', 'closed', 'jumped', 'waited', 'pushed', 'pulled',
  'checked', 'tried', 'cleared', 'dodged', 'grabbed', 'built', 'crafted', 'explored', 'raced', 'won',
  'paused', 'loaded', 'aimed', 'walked', 'sprinted', 'hid', 'peeked', 'solved', 'collected', 'started'
]

const SLANG = [
  'lowkey clean', 'highkey fun', 'let him cook', 'aura up', 'its giving clutch', 'no cap', 'ate that',
  'so mid', 'peak cinema', 'npc moment', 'main character', 'ratio', 'goated', 'understood the assignment',
  'rent free', 'core memory', 'lock in', 'skill issue but kind', 'delulu win', 'six seven', 'bussin run',
  'slay the puzzle', 'touch grass later', 'we move', 'caught in 4k', 'not the strat', 'chat is this real',
  'big W', 'big L', 'thats fire'
]

const QUESTIONS = [
  'what is this', 'wait what happened', 'are we speedrunning', 'why did that hit', 'is this a boss',
  'what are we looking at', 'menu moment?', 'where are we going', 'did that count', 'one more try?',
  'is the timer on', 'which way now', 'was that on purpose', 'chat are we winning', 'what does that do',
  'who left that there'
]

const JOKES = [
  'why did the slime cross the road? the loot was over there',
  'this boss has two moves: wave and wait',
  'I would help but I am a chat message',
  'the menu is the real final boss',
  'speedrun strats: hope and a snack',
  'inventory full of good ideas',
  'the tutorial was a suggestion',
  'save the game and the vibe',
  'that jump had main character music',
  'the chest was empty but the joke landed',
  'we take those',
  'calculated. totally calculated.',
  'the map is just a suggestion too',
  'pause menu appreciation post',
  'someone give the timer a pep talk',
  'chat is doing the math badly'
]

const TAILS = [
  'rn', 'tho', 'fr', 'chat', 'pls', '??', 'lowkey', 'tbh', 'ok?', 'help', 'gg', 'wild', 'actually',
  'wait', 'hold on', 'again', 'real', 'moment', 'core', 'check'
]

const HEADS = [
  'yo chat', 'wait wait', 'ok but', 'not gonna lie', 'hear me out', 'quick question', 'love that',
  'hate the timer', 'nice timing', 'so close', 'we move', 'one more', 'dont blink', 'look at that',
  'chat check', 'I saw that', 'no way', 'yes way', 'fair enough', 'good call', 'bold move', 'smooth',
  'rough beat', 'clean hands', 'sleepy chat', 'wide awake', 'new plan', 'old plan', 'side quest',
  'main quest', 'tiny win', 'big win', 'soft reset', 'hard save', 'lucky roll', 'unlucky roll'
]

const FILLERS = [
  'wait {word}?',
  '{word} {word} {word}',
  'W {word}',
  'L {word}',
  'not the {word}',
  'chat {word}',
  '{word} moment',
  'why {word}',
  'ok but {word}',
  '{word} is {adj}',
  'the {word} {verb}',
  '{react} {word}',
  '{emote} {word}',
  'did they just say {word}',
  '{word} check',
  'real {word}',
  '{word} arc',
  'hold on {word}',
  '{word} again??',
  'I heard {word}',
  '{slang}',
  '{react}',
  '{emote}',
  '{adj} {noun}',
  '{noun} {verb}',
  '{react} {adj} {noun}',
  'spam {emote}',
  '{emote} {emote} {emote}'
]

function buildTemplates(): string[] {
  const templates = [...FILLERS, ...HYPE, ...QUESTIONS, ...JOKES, ...SLANG, ...FRAGMENTS]
  for (const head of HEADS) {
    templates.push(head)
    for (const tail of TAILS) templates.push(`${head} ${tail}`)
  }
  return templates
}

export const LOCAL_TEMPLATES = buildTemplates()
export const LOCAL_TEMPLATE_COUNT = LOCAL_TEMPLATES.length
export const LOCAL_WORD_COUNT =
  FRAGMENTS.length +
  EMOTES.length +
  HYPE.length +
  ADJECTIVES.length +
  NOUNS.length +
  VERBS.length +
  SLANG.length +
  QUESTIONS.length +
  JOKES.length +
  TAILS.length +
  HEADS.length

const SAFE_FALLBACK = ['nice', 'ok', 'watching', 'hmm', 'W', 'chat', 'gg']

export type LocalMode = 'template' | 'echo' | 'screen' | 'copy' | 'rant' | 'emote' | 'caps' | 'typo' | 'bored'

export interface LocalSpeaker {
  name: string
  badge: Badge
  color: string
}

export interface LocalInput {
  count: number
  rng: () => number
  avoid: Set<string>
  transcripts?: string[]
  pcAudio?: string[]
  recentLines?: string[]
  screen?: ScreenCue | null
  boredom?: number
  roster?: LocalSpeaker[]
  now?: number
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

export function echoWords(texts: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const text of texts) {
    for (const raw of text.split(/[^A-Za-z0-9']+/)) {
      const word = raw.replace(/'/g, '').toLowerCase()
      if (word.length < 3 || word.length > 18) continue
      if (STOP.has(word) || seen.has(word)) continue
      if (!isKidSafe(word)) continue
      seen.add(word)
      out.push(word)
    }
  }
  return out
}

function stripSpeaker(line: string): string {
  const index = line.indexOf(':')
  return (index >= 0 ? line.slice(index + 1) : line).trim()
}

function safeTitle(title: string | null | undefined): string | null {
  if (!title) return null
  const trimmed = title.replace(/\s+/g, ' ').trim().slice(0, 48)
  if (!trimmed || !isKidSafe(trimmed)) return null
  return trimmed
}

function fill(template: string, rng: () => number, keywords: string[]): string {
  const word = keywords.length ? pick(keywords, rng) : pick(NOUNS, rng)
  return template
    .replaceAll('{word}', word)
    .replaceAll('{adj}', () => pick(ADJECTIVES, rng))
    .replaceAll('{verb}', () => pick(VERBS, rng))
    .replaceAll('{noun}', () => pick(NOUNS, rng))
    .replaceAll('{react}', () => pick(FRAGMENTS, rng))
    .replaceAll('{emote}', () => pick(EMOTES, rng))
    .replaceAll('{slang}', () => pick(SLANG, rng))
}

function typoWord(word: string, rng: () => number): string {
  if (word.length < 4) return word
  const index = 1 + Math.floor(rng() * (word.length - 2))
  const roll = rng()
  if (roll < 0.34) return word.slice(0, index) + word[index] + word.slice(index)
  if (roll < 0.67 && index + 1 < word.length) {
    return word.slice(0, index) + word[index + 1] + word[index] + word.slice(index + 2)
  }
  return word.slice(0, index) + word.slice(index + 1)
}

function applyTypo(text: string, rng: () => number): string {
  const parts = text.split(' ')
  const index = parts.findIndex((part) => part.length >= 4 && /^[a-zA-Z]+$/.test(part))
  if (index < 0) return text
  const current = parts[index] ?? ''
  parts[index] = typoWord(current, rng)
  return parts.join(' ')
}

function screenLine(screen: ScreenCue, rng: () => number): string {
  const title = safeTitle(screen.title)
  if (screen.colors.length && rng() < 0.55) {
    const color = screen.colors[Math.min(screen.colors.length - 1, Math.floor(rng() * screen.colors.length))] ?? 'bright'
    const lines = [
      `why is it so ${color}`,
      `that ${color} is everywhere`,
      `nice ${color}`,
      `the ${color} popped`,
      `${color} ${color} ${color}`
    ]
    return pick(lines, rng)
  }
  if (title && rng() < 0.55) {
    const lines = [`is this ${title}?`, `${title} looks fun`, `we are in ${title}`, `wait this is ${title}`]
    return pick(lines, rng)
  }
  if (screen.change < 0.1) {
    return pick(['nothing moved', 'screen is frozen', 'still the same', 'zzz the screen', 'static screen lol', 'did the screen freeze'], rng)
  }
  if (screen.change > 0.55) {
    return pick(
      ['the screen just jumped', 'WHOA what changed', 'big change', 'chat did you see that', 'everything moved', 'that was a hard cut'],
      rng
    )
  }
  return pick(['new frame', 'something shifted', 'ok a little change', 'I saw a flicker'], rng)
}

function rant(rng: () => number, keywords: string[]): string {
  const banks = [ADJECTIVES, NOUNS, VERBS, FRAGMENTS, SLANG]
  const count = 4 + Math.floor(rng() * 4)
  const words: string[] = []
  for (let i = 0; i < count; i++) {
    if (keywords.length && rng() < 0.4) words.push(pick(keywords, rng))
    else words.push(pick(pick(banks, rng), rng))
  }
  return words.join(' ').slice(0, 180)
}

function emoteSpam(rng: () => number): string {
  const emote = pick(EMOTES, rng)
  const count = 3 + Math.floor(rng() * 4)
  return Array.from({ length: count }, () => emote).join(' ')
}

function copyLine(recent: string[], rng: () => number): string {
  const text = stripSpeaker(pick(recent, rng))
  if (!text) return pick(FRAGMENTS, rng)
  const roll = rng()
  if (roll < 0.34) return `${text} ${text}`.slice(0, 180)
  if (roll < 0.6) return `^^^ ${text}`.slice(0, 180)
  return text.slice(0, 180)
}

export function composeLocalLine(input: {
  rng: () => number
  keywords: string[]
  recent: string[]
  screen: ScreenCue | null
  boredom?: number
  mode?: LocalMode
}): string {
  const rng = input.rng
  const mode = input.mode ?? pickMode(rng, input.keywords, input.recent, input.screen, input.boredom ?? 0)
  if (mode === 'bored') return pick(BORED_LINES, rng)
  if (mode === 'screen' && input.screen) return screenLine(input.screen, rng)
  if (mode === 'echo' && input.keywords.length) return fill(pick(FILLERS, rng), rng, input.keywords)
  if (mode === 'copy' && input.recent.length) return copyLine(input.recent, rng)
  if (mode === 'rant') return rant(rng, input.keywords)
  if (mode === 'emote') return emoteSpam(rng)
  if (mode === 'caps') return pick(HYPE, rng).toUpperCase()
  if (mode === 'typo') return applyTypo(fill(pick(LOCAL_TEMPLATES, rng), rng, input.keywords), rng)
  return fill(pick(LOCAL_TEMPLATES, rng), rng, input.keywords)
}

function pickMode(rng: () => number, keywords: string[], recent: string[], screen: ScreenCue | null, boredom: number): LocalMode {
  if (boredom > 0.72 && rng() < 0.45) return 'bored'
  const roll = rng()
  if (keywords.length && roll < 0.22) return 'echo'
  if (screen && roll < 0.36) return 'screen'
  if (recent.length && roll < 0.5) return 'copy'
  if (roll < 0.62) return 'rant'
  if (roll < 0.72) return 'emote'
  if (roll < 0.8) return 'caps'
  if (roll < 0.88) return 'typo'
  return 'template'
}

function badgeFor(rng: () => number): Badge {
  const roll = rng()
  if (roll < 0.08) return 'mod'
  if (roll < 0.16) return 'vip'
  if (roll < 0.3) return 'sub'
  return null
}

function speakerFor(input: LocalInput, used: Set<string>): LocalSpeaker {
  const roster = (input.roster ?? []).filter((person) => !used.has(person.name.toLowerCase()))
  if (roster.length && input.rng() < 0.8) return pick(roster, input.rng)
  const name = makeUsername(input.rng, new Set([...input.avoid, ...used]))
  return { name, badge: badgeFor(input.rng), color: colorFor(name) }
}

export function makeLocalMessages(input: LocalInput): ChatMessage[] {
  const recent = input.recentLines ?? []
  const keywords = echoWords([
    ...(input.transcripts ?? []),
    ...(input.pcAudio ?? []),
    ...recent.map(stripSpeaker)
  ]).slice(0, 16)
  const screen = input.screen
    ? { ...input.screen, title: safeTitle(input.screen.title) }
    : null
  const messages: ChatMessage[] = []
  const usedText = new Set<string>()
  const usedNames = new Set<string>()
  const now = input.now ?? Date.now()
  for (let i = 0; i < input.count; i++) {
    let text = ''
    const forceBored = (input.boredom ?? 0) > 0.72 && i === 0
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = composeLocalLine({
        rng: input.rng,
        keywords,
        recent,
        screen,
        boredom: input.boredom,
        mode: forceBored ? 'bored' : undefined
      })
      const key = candidate.toLowerCase()
      if (!candidate || usedText.has(key) || !isKidSafe(candidate)) continue
      text = candidate
      usedText.add(key)
      break
    }
    if (!text) text = pick(SAFE_FALLBACK, input.rng)
    const speaker = speakerFor(input, usedNames)
    usedNames.add(speaker.name.toLowerCase())
    input.avoid.add(speaker.name.toLowerCase())
    messages.push({
      id: makeId(now + i, input.rng),
      username: speaker.name,
      badge: speaker.badge,
      color: speaker.color,
      text,
      kind: 'chat'
    })
  }
  return messages
}
