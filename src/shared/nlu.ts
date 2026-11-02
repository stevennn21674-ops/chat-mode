import { isKidSafe } from './filter'
import type { Badge } from './types'

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'it', 'that', 'this', 'you',
  'we', 'im', 'its', 'was', 'be', 'are', 'just', 'like', 'with', 'have', 'has', 'but', 'not', 'they',
  'them', 'then', 'than', 'from', 'your', 'youre', 'gonna', 'gotta', 'dont', 'cant', 'wont', 'i', 'me'
])

export const GAMES = [
  'roblox', 'minecraft', 'fortnite', 'backrooms', 'fnf', 'funkin', 'valorant', 'terraria', 'stardew',
  'mario', 'zelda', 'pokemon', 'apex', 'overwatch', 'among', 'fallguys', 'doors', 'brookhaven',
  'bedwars', 'arsenal', 'blox', 'adopt', 'geometry', 'phasmophobia', 'lethal', 'content', 'gta',
  'robloxian', 'obby', 'mm2', 'piggy', 'dresstoimpress'
]

export const ENTITIES = [
  'smiler', 'hounds', 'hound', 'bacteria', 'partygoer', 'faceling', 'wretch', 'deathmoth', 'howler',
  'creeper', 'zombie', 'enderman', 'herobrine', 'impostor', 'ghost', 'entity', 'monster', 'boss',
  'skinwalker', 'lurker', 'exit'
]

export const PLACES = [
  'lobby', 'spawn', 'nether', 'end', 'dropper', 'mansion', 'school', 'mall', 'poolrooms', 'level',
  'cave', 'base', 'village', 'arena', 'sewer', 'office', 'hotel', 'yellow', 'rooms'
]

export const EMOTIONS = [
  'happy', 'sad', 'scared', 'angry', 'hyped', 'bored', 'excited', 'nervous', 'proud', 'confused',
  'shocked', 'calm', 'silly', 'worried', 'pumped', 'tired', 'cozy', 'mad', 'glad', 'lonely'
]

export const QUESTION_WORDS = ['who', 'what', 'why', 'how', 'when', 'where', 'which', 'whats', 'whos']

export const GREETINGS = ['hi', 'hey', 'hello', 'yo', 'sup', 'howdy', 'hiya', 'welcome', 'heya']

export const COMPLIMENTS = ['clean', 'goated', 'nice', 'clutch', 'fire', 'peak', 'legend', 'smart', 'cool', 'brave', 'good', 'great', 'love', 'best']

export const LIGHT_TEASE = ['mid', 'cooked', 'washed', 'slow', 'laggy', 'questionable', 'clumsy', 'lost', 'oops']

export const SCARE_WORDS = ['scared', 'scare', 'horror', 'jumpscare', 'monster', 'smiler', 'hound', 'hounds', 'creepy', 'behind', 'dark', 'scream']

export const WIN_WORDS = ['win', 'won', 'victory', 'clutch', 'gg', 'champion', 'clear', 'beat', 'escaped']

export const LOSE_WORDS = ['lose', 'lost', 'died', 'dead', 'death', 'fail', 'failed', 'rip', 'downed', 'eliminated']

const POSITIVE = new Set([...COMPLIMENTS, 'win', 'won', 'gg', 'lets', 'hype', 'love', 'fun', 'safe', 'escaped'])
const NEGATIVE = new Set([...SCARE_WORDS, ...LOSE_WORDS, ...LIGHT_TEASE, 'no', 'bad', 'hurt'])

export const REACTIONS: Record<string, string[]> = {
  roblox: ['oof', 'roblox moment', 'that obby tho', 'reset character'],
  minecraft: ['creeper??', 'mine the diamonds', 'this base is clean', 'dont dig straight down'],
  fortnite: ['thats a dub', 'no build?', 'storm is coming'],
  backrooms: ['level 0 vibes', 'do not noclip', 'the lights are buzzing', 'find the exit'],
  fnf: ['left right', 'that chart is mean', 'missed the note'],
  funkin: ['friday night funkin', 'boyfriend is trying', 'the arrows tho'],
  smiler: ['SMILER NO', 'dont look at it', 'BEHIND YOU'],
  hounds: ['the hounds are close', 'RUN', 'dont stop'],
  hound: ['I hear the hounds', 'RUN'],
  exit: ['the exit is right there', 'go for the exit', 'dont miss the exit'],
  minecraft_creeper: ['creeper behind you'],
  creeper: ['creeper??', 'ssss BOOM', 'back up'],
  fortnite_win: ['Victory Royale'],
  doors: ['hide in the closet', 'next door next door'],
  piggy: ['piggy is coming', 'hide'],
  valorant: ['nice aim', 'clutch round'],
  terraria: ['that boss though', 'more wood'],
  mario: ['lets a go', 'the jump tho'],
  zelda: ['puzzle room', 'save first']
}

const SCARE_LINES = ['LETS GOOO', 'NOOO', 'RUN', 'BEHIND YOU']
const WIN_LINES = ['GG', 'W', 'LETS GOOO', 'huge']
const LOSE_LINES = ['GG', 'F', 'RIP', 'L']
const GREET_LINES = ['hey hey', 'hellooo', 'yo welcome', 'hi hi', 'heyy']
const ADVICE = [
  'check the corner',
  'save first',
  'dont rush',
  'watch behind you',
  'try the other door',
  'heal first',
  'look up',
  'slow down a second'
]

export type Intent = 'question' | 'greeting' | 'scare' | 'win' | 'lose' | 'ask-chat' | 'name' | 'compliment' | 'insult' | 'joke' | 'none'

export type Personality = 'hyper' | 'lurker' | 'troll' | 'mod' | 'backseat' | 'questioner'

export interface IntentHit {
  intent: Intent
  focus: string
}

export interface TermStat {
  count: number
  lastAt: number
  sentiment: number
}

export interface TermMemory {
  terms: Map<string, TermStat>
  joke: string
}

const TOPIC_MS = 20 * 60 * 1000

export function createMemory(): TermMemory {
  return { terms: new Map(), joke: '' }
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((word) => word.replace(/'/g, ''))
    .filter((word) => word.length >= 1 && word.length <= 24)
}

export function noteText(memory: TermMemory, text: string, now: number): void {
  for (const word of tokens(text)) {
    if (!isKidSafe(word)) continue
    const hit = POSITIVE.has(word) ? 1 : NEGATIVE.has(word) ? -1 : 0
    const prev = memory.terms.get(word)
    const count = (prev?.count ?? 0) + 1
    memory.terms.set(word, {
      count,
      lastAt: now,
      sentiment: prev ? prev.sentiment * 0.7 + hit * 0.3 : hit
    })
    if (count >= 3 && !STOP.has(word) && word.length >= 3 && !memory.joke) memory.joke = word
  }
  if (memory.terms.size > 400) {
    const oldest = [...memory.terms.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt)[0]
    if (oldest) memory.terms.delete(oldest[0])
  }
}

export function recentTopics(memory: TermMemory, now: number, windowMs = TOPIC_MS): string[] {
  return [...memory.terms.entries()]
    .filter(([word, stat]) => now - stat.lastAt <= windowMs && !STOP.has(word) && word.length >= 3)
    .sort((a, b) => b[1].count - a[1].count || b[1].lastAt - a[1].lastAt)
    .slice(0, 12)
    .map(([word]) => word)
}

export function knownTopic(word: string): boolean {
  const key = word.toLowerCase()
  return GAMES.includes(key) || ENTITIES.includes(key) || PLACES.includes(key) || key in REACTIONS
}

function hasWord(text: string, words: readonly string[]): string {
  const keys = new Set(tokens(text))
  return words.find((word) => keys.has(word)) ?? ''
}

const FOCUS_SKIP = new Set([...STOP, ...QUESTION_WORDS, 'chat', 'should', 'would', 'could', 'please', 'do', 'did', 'does'])

export function contentFocus(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !FOCUS_SKIP.has(word))
  return words.slice(-3).join(' ').slice(0, 48)
}

export function detectIntent(text: string, opts?: { loud?: boolean; names?: string[] }): IntentHit {
  const clean = text.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim()
  const scare = hasWord(clean, SCARE_WORDS)
  if (opts?.loud || scare) return { intent: 'scare', focus: scare || 'loud' }
  const lost = hasWord(clean, LOSE_WORDS)
  if (lost) return { intent: 'lose', focus: lost }
  const won = hasWord(clean, WIN_WORDS)
  if (won) return { intent: 'win', focus: won }
  if (/^(hi|hey|hello|yo|sup|howdy|hiya|heya)\b/.test(clean)) return { intent: 'greeting', focus: clean.split(' ')[0] ?? 'hi' }
  const asking = /\bchat\b/.test(clean) && (clean.includes('?') || QUESTION_WORDS.some((word) => clean.split(' ').includes(word)) || /\b(should|do you|what do)\b/.test(clean))
  if (asking) {
    const known = hasWord(clean, [...GAMES, ...ENTITIES, ...PLACES])
    return { intent: 'ask-chat', focus: known || contentFocus(clean) || 'that' }
  }
  if (clean.includes('?') || QUESTION_WORDS.some((word) => clean.startsWith(`${word} `) || clean.split(' ').includes(word))) {
    const known = hasWord(clean, [...GAMES, ...ENTITIES, ...PLACES, ...EMOTIONS])
    return { intent: 'question', focus: known || contentFocus(clean) || 'that' }
  }
  const named = (opts?.names ?? []).find((name) => {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (key.length < 3) return false
    return clean.split(' ').some((word) => {
      const token = word.replace(/[^a-z0-9]/g, '')
      return token === key || (token.length >= 4 && (key.includes(token) || token.includes(key)))
    })
  })
  if (named) return { intent: 'name', focus: named }
  const tease = hasWord(clean, LIGHT_TEASE)
  if (tease) return { intent: 'insult', focus: tease }
  const kind = hasWord(clean, COMPLIMENTS)
  if (kind) return { intent: 'compliment', focus: kind }
  if (/\b(joke|lol|lmao|haha|funny)\b/.test(clean)) return { intent: 'joke', focus: 'joke' }
  const topic = hasWord(clean, [...GAMES, ...ENTITIES, ...PLACES])
  return { intent: 'none', focus: topic }
}

export function personalityFor(name: string, badge: Badge | null): Personality {
  if (badge === 'mod') return 'mod'
  const kinds: Personality[] = ['hyper', 'lurker', 'troll', 'backseat', 'questioner', 'hyper']
  let hash = 0
  for (const char of name) hash = (hash * 33 + char.charCodeAt(0)) >>> 0
  return kinds[hash % kinds.length] ?? 'hyper'
}

export function letterSpam(word: string): string {
  const char = (word.match(/[A-Za-z]/)?.[0] ?? 'w').toUpperCase()
  return `${char} ${char} ${char} ${char}`
}

export function columnWord(word: string): string {
  const letters = word.replace(/[^A-Za-z]/g, '').slice(0, 8).toUpperCase()
  if (letters.length < 2) return letterSpam(word)
  return letters.split('').join('\n')
}

export function stretchWord(word: string): string {
  const clean = word.replace(/[^A-Za-z]/g, '')
  if (!clean) return 'noooooo'
  const index = Math.max(0, clean.search(/[aeiou]/i))
  const char = clean[index] ?? clean[clean.length - 1] ?? 'o'
  const stretched = clean.slice(0, index) + char.repeat(5) + clean.slice(index + 1)
  return stretched.slice(0, 24)
}

export function misspellWord(word: string): string {
  const clean = word.replace(/[^A-Za-z]/g, '')
  if (clean.length < 4) return clean || word
  const index = 1
  return clean.slice(0, index) + clean[index + 1] + clean[index] + clean.slice(index + 2)
}

export function safeEcho(text: string): string {
  const parts = text.split(/\s+/).filter((word) => word && word.length <= 24 && isKidSafe(word))
  return parts.join(' ').slice(0, 120)
}

export function autoReaction(word: string, rng: () => number): string | null {
  const lines = REACTIONS[word.toLowerCase()]
  if (!lines?.length) return null
  return lines[Math.min(lines.length - 1, Math.floor(rng() * lines.length))] ?? null
}

function pick(lines: readonly string[], rng: () => number): string {
  return lines[Math.min(lines.length - 1, Math.floor(rng() * lines.length))] ?? lines[0] ?? 'nice'
}

export function nluLine(input: {
  rng: () => number
  intent: Intent
  focus?: string
  keywords?: string[]
  personality?: Personality
  joke?: string
  fact?: string
  knowledge?: string
}): string {
  const rng = input.rng
  const word = (input.keywords ?? []).find((item) => isKidSafe(item) && !STOP.has(item)) || input.focus || 'that'
  const safeWord = isKidSafe(word) ? word : 'that'
  let line = ''
  if (input.personality === 'lurker' && rng() < 0.65) line = pick(['watching', 'hmm', 'ok', 'still here'], rng)
  else if (input.personality === 'backseat' && rng() < 0.55) line = pick(ADVICE, rng)
  else if (input.intent === 'scare') line = pick(SCARE_LINES, rng)
  else if (input.intent === 'win') line = pick(WIN_LINES, rng)
  else if (input.intent === 'lose') line = pick(LOSE_LINES, rng)
  else if (input.intent === 'greeting') line = pick(GREET_LINES, rng)
  else if (input.intent === 'ask-chat') {
    const focus = input.focus && input.focus !== 'that' ? input.focus : safeWord !== 'that' ? safeWord : ''
    const lines = focus
      ? [`I would ${focus}`, `go for ${focus}`, `chat says ${focus}`, `yeah ${focus}`]
      : ['I would wait', 'go slow', 'trust it', 'one more try']
    line = pick(lines, rng)
  }
  else if (input.intent === 'question') {
    const focus = input.focus && input.focus !== 'that' ? input.focus : safeWord
    const games = new Set(['Roblox', 'Minecraft', 'Fortnite', 'FNF', 'Escape the Backrooms'])
    if (games.has(focus)) line = `this is ${focus}`
    else line = pick([`I think ${focus}`, `maybe ${focus}`, `check ${focus}`, `${focus}??`], rng)
  }
  else if (input.intent === 'name' && input.focus && isKidSafe(input.focus)) line = pick([`yo ${input.focus}`, `${input.focus} fr`, `${input.focus} you saw that`], rng)
  else if (input.intent === 'compliment') line = pick(['so true', 'W', 'they are goated', 'love that'], rng)
  else if (input.intent === 'insult') line = pick(['that was mid', 'skill issue but kind', 'not the play', 'hmm sure'], rng)
  else if (input.intent === 'joke') line = pick(['why did the slime cross the road', 'the menu is the boss', 'calculated. totally calculated.'], rng)
  else if (input.fact && rng() < 0.45) line = `that's from the wiki lol`
  else if (input.knowledge && rng() < 0.4) line = input.knowledge
  else if (input.joke && isKidSafe(input.joke) && rng() < 0.35) line = `the ${input.joke} arc continues`
  else line = autoReaction(safeWord, rng) || (safeEcho(safeWord) ? `they said ${safeEcho(safeWord)}` : pick(['real', 'chat', 'wait', 'W'], rng))

  const style = rng()
  const shout = input.intent === 'scare' || input.intent === 'win' || input.intent === 'lose' || input.intent === 'greeting'
  const literal = input.intent === 'question' || input.intent === 'ask-chat' || input.intent === 'name'
  if (!literal && (input.personality === 'hyper' || (!shout && style < 0.18))) {
    if (style < 0.06) line = stretchWord(line.split(' ')[0] || line)
    else if (style < 0.1) line = letterSpam(safeWord)
    else if (style < 0.14) line = columnWord(safeWord)
    else if (style < 0.18 && input.personality === 'hyper') line = line.toUpperCase()
  }
  if (input.personality === 'troll' && !line.toLowerCase().includes('mid')) line = `mid. ${line}`
  if (input.personality === 'questioner' && !line.includes('?')) line = `${line}?`
  if (input.personality === 'mod') line = `chat ${line}`.slice(0, 160)
  const clipped = line.replace(/\s+/g, ' ').trim().slice(0, 180)
  return clipped && isKidSafe(clipped) ? clipped : 'nice'
}

export function jokeLine(joke: string): string {
  const word = joke.replace(/[^a-z0-9]/gi, '').slice(0, 24)
  if (!word || !isKidSafe(word)) return ''
  return `the ${word} arc continues`
}

export function replyToViewer(line: string, rng: () => number): string | null {
  const split = line.indexOf(':')
  const name = split >= 0 ? line.slice(0, split).trim() : ''
  const text = (split >= 0 ? line.slice(split + 1) : line).trim()
  if (!text || !isKidSafe(text) || (name && !isKidSafe(name))) return null
  const intent = detectIntent(text)
  if (intent.intent === 'question' || intent.intent === 'ask-chat' || text.includes('?')) {
    const focus = intent.focus && intent.focus !== 'that' ? intent.focus : contentFocus(text)
    const answer = focus ? `I think ${focus}` : 'not sure'
    return (name ? `${name} ${answer}` : answer).slice(0, 160)
  }
  if (name && rng() < 0.7) return `${name} fr`
  return null
}

export function offlineReply(
  text: string,
  opts?: { game?: string | null; names?: string[]; joke?: string; recent?: string }
): string {
  if (opts?.game && /\bgame\b/i.test(text) && /\b(what|which|this)\b/i.test(text)) return `this is ${opts.game}`
  const intent = detectIntent(text, { names: opts?.names })
  if (intent.intent === 'none' && opts?.recent) {
    const reply = replyToViewer(opts.recent, () => 0)
    if (reply) return reply
  }
  if (intent.intent === 'none' && opts?.joke) {
    const joke = jokeLine(opts.joke)
    if (joke) return joke
  }
  return nluLine({
    rng: () => 0,
    intent: intent.intent,
    focus: intent.focus,
    keywords: intent.focus ? [intent.focus] : [],
    joke: opts?.joke
  })
}
