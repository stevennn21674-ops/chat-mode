import { isKidSafe } from './filter'
import { detectIntent, ENTITIES, GAMES, knownTopic, PLACES } from './nlu'

export interface HeardLine {
  at: number
  text: string
  source: 'mic' | 'pc' | 'title'
}

export interface Entity {
  name: string
  mentions: number
  lastAt: number
  words: string[]
  role: string
}

export interface StoryEvent {
  at: number
  label: string
}

export interface Knowledge {
  lines: HeardLine[]
  entities: Entity[]
  events: StoryEvent[]
}

const WINDOW_MS = 20 * 60 * 1000
const ROLE_WORDS = ['streamer', 'enemy', 'friend', 'boss', 'teammate']
const SKIP = new Set(['the', 'this', 'that', 'chat', 'mode', 'window', 'what', 'when', 'where', 'your', 'have'])

export function createKnowledge(): Knowledge {
  return { lines: [], entities: [], events: [] }
}

function prune(knowledge: Knowledge, now: number): void {
  knowledge.lines = knowledge.lines.filter((line) => now - line.at <= WINDOW_MS).slice(-80)
  knowledge.events = knowledge.events.filter((event) => now - event.at <= WINDOW_MS).slice(-12)
}

function rememberEntity(knowledge: Knowledge, name: string, now: number, role: string, near: string[]): void {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 32)
  if (clean.length < 3 || !isKidSafe(clean)) return
  const key = clean.toLowerCase()
  if (SKIP.has(key)) return
  let entity = knowledge.entities.find((item) => item.name.toLowerCase() === key)
  if (!entity) {
    entity = { name: clean, mentions: 0, lastAt: now, words: [], role: '' }
    knowledge.entities.push(entity)
  }
  entity.mentions += 1
  entity.lastAt = now
  if (role && !entity.role) entity.role = role
  for (const word of near) {
    if (!entity.words.includes(word) && entity.words.length < 6) entity.words.push(word)
  }
  if (knowledge.entities.length > 40) {
    knowledge.entities.sort((a, b) => b.lastAt - a.lastAt)
    knowledge.entities.length = 40
  }
}

function eventLabel(text: string): string {
  const hit = detectIntent(text)
  if (hit.intent === 'scare') return 'scared'
  if (hit.intent === 'win') return 'winning'
  if (hit.intent === 'lose') return 'lost'
  if (/\b(fight|fighting|battle|attack|combat)\b/i.test(text)) return 'fighting'
  if (/\b(explor\w*|looking|wandering|level)\b/i.test(text)) return 'exploring'
  if (hit.intent === 'greeting') return 'greeting'
  return ''
}

export function ingest(knowledge: Knowledge, text: string, source: HeardLine['source'], now: number): void {
  const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 240)
  if (trimmed.length < 2) return
  prune(knowledge, now)
  if (knowledge.lines.at(-1)?.text !== trimmed) knowledge.lines.push({ at: now, text: trimmed, source })
  const role = ROLE_WORDS.find((word) => new RegExp(`\\b${word}\\b`, 'i').test(trimmed)) ?? ''
  const lowerWords = trimmed.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3)
  const counts = new Map<string, number>()
  for (const word of lowerWords) counts.set(word, (counts.get(word) ?? 0) + 1)
  const near = lowerWords.filter((word) => !SKIP.has(word)).slice(0, 6)
  const capitalized = trimmed.match(/\b[A-Z][A-Za-z0-9_]{2,}\b/g) ?? []
  for (const name of capitalized) rememberEntity(knowledge, name, now, role, near)
  for (const word of new Set(lowerWords)) {
    if (knownTopic(word) || GAMES.includes(word) || ENTITIES.includes(word) || PLACES.includes(word)) {
      rememberEntity(knowledge, word, now, role, near)
    } else if ((counts.get(word) ?? 0) >= 2 && !SKIP.has(word)) {
      rememberEntity(knowledge, word, now, role, near)
    }
  }
  const label = eventLabel(trimmed)
  if (label && knowledge.events.at(-1)?.label !== label) knowledge.events.push({ at: now, label })
}

export function lookupCandidate(knowledge: Knowledge, seen: Set<string>): string | null {
  const ranked = [...knowledge.entities].sort((a, b) => b.mentions - a.mentions || b.lastAt - a.lastAt)
  for (const entity of ranked) {
    const key = entity.name.toLowerCase()
    if (seen.has(key)) continue
    if (knownTopic(key) || GAMES.includes(key) || entity.mentions >= 2) return entity.name
  }
  return null
}

export function referenceLine(knowledge: Knowledge, rng: () => number): string | null {
  const entity = knowledge.entities[Math.min(knowledge.entities.length - 1, Math.floor(rng() * knowledge.entities.length))]
  if (!entity) return null
  const event = knowledge.events.at(-1)?.label
  const older = knowledge.events.length > 1 ? knowledge.events[knowledge.events.length - 2]?.label : ''
  const lines = [
    `wait who is ${entity.name}`,
    `${entity.name} is cooked`,
    event ? `did they just ${event === 'lost' ? 'die' : event}?` : `${entity.name} again`,
    older ? `earlier it was ${older}` : `${entity.name} lore`,
    entity.role ? `${entity.name} is the ${entity.role}` : `remember ${entity.name}`
  ]
  const line = lines[Math.min(lines.length - 1, Math.floor(rng() * lines.length))] ?? ''
  return line && isKidSafe(line) ? line : null
}

export function compactContext(knowledge: Knowledge, now: number): string {
  prune(knowledge, now)
  const heard = knowledge.lines.slice(-3).map((line) => line.text.slice(0, 80)).join(' | ')
  const people = knowledge.entities
    .slice()
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 5)
    .map((entity) => `${entity.name}${entity.role ? ` ${entity.role}` : ''} x${entity.mentions}`)
    .join(', ')
  const nowEvent = knowledge.events.at(-1)?.label ?? ''
  const earlier = knowledge.events.slice(-4, -1).map((event) => event.label).join(', ')
  const parts = [
    heard ? `Heard: ${heard}` : '',
    people ? `People: ${people}` : '',
    nowEvent ? `Now: ${nowEvent}` : '',
    earlier ? `Earlier: ${earlier}` : ''
  ].filter(Boolean)
  return parts.join('. ').slice(0, 420)
}
