import { colorFor } from './color'
import { isKidSafe } from './filter'
import { letterSpam, stretchWord } from './nlu'
import type { Badge } from './types'

export type ViewerRole = 'viewer' | 'mod' | 'hater' | 'hyper' | 'lurker' | 'backseat' | 'vip' | 'sub' | 'custom'

export interface CustomViewer {
  id: string
  username: string
  role: ViewerRole
  color: string
  active: boolean
  description: string
  talkativeness: number
  positivity: number
  hype: number
  trolling: number
  presence: number
  emoji: number
  caps: number
  slang: number
  phrases: string[]
  topics: string[]
}

export interface CustomCrowd {
  viewers: CustomViewer[]
  randomNames: string[]
}

const ROLES: ViewerRole[] = ['viewer', 'mod', 'hater', 'hyper', 'lurker', 'backseat', 'vip', 'sub', 'custom']

const TEASE = ['that was mid', 'not the play', 'hmm sure', 'skill issue but kind', 'we can do better', 'questionable']
const HYPE = ['LETS GOOO', 'W', 'huge', 'that was clean', 'one more']
const LURK = ['watching', 'hmm', 'ok', 'still here']
const ADVICE = ['check the corner', 'save first', 'dont rush', 'go for the exit', 'watch behind you', 'try the other door']
const EMOTES = ['😂', '🔥', '💀', '👏', '😭', '✨', '🎮', '❤️']

export function emptyCrowd(): CustomCrowd {
  return { viewers: [], randomNames: [] }
}

function clampSlider(value: unknown, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(100, Math.max(0, Math.round(number)))
}

function cleanList(value: unknown, max: number): string[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : []
  const out: string[] = []
  for (const item of source) {
    if (typeof item !== 'string') continue
    const text = item.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!text || !isKidSafe(text)) continue
    if (!out.some((have) => have.toLowerCase() === text.toLowerCase())) out.push(text)
    if (out.length >= max) break
  }
  return out
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const name = value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 18)
  if (name.length < 3 || !isKidSafe(name)) return ''
  return name
}

function cleanRole(value: unknown): ViewerRole {
  return ROLES.includes(value as ViewerRole) ? (value as ViewerRole) : 'viewer'
}

export function badgeOf(role: ViewerRole): Badge {
  if (role === 'mod') return 'mod'
  if (role === 'vip') return 'vip'
  if (role === 'sub') return 'sub'
  return null
}

export function blankViewer(id: string, username = 'viewer'): CustomViewer {
  const name = cleanName(username) || 'viewer'
  return {
    id: id.slice(0, 40),
    username: name,
    role: 'viewer',
    color: colorFor(name),
    active: true,
    description: '',
    talkativeness: 50,
    positivity: 60,
    hype: 40,
    trolling: 10,
    presence: 50,
    emoji: 30,
    caps: 20,
    slang: 30,
    phrases: [],
    topics: []
  }
}

export function sanitizeViewer(value: unknown, index: number): CustomViewer | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const username = cleanName(raw.username)
  if (!username) return null
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 40) : `cv-${index}-${username}`
  const description = typeof raw.description === 'string' ? raw.description.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
  return {
    id,
    username,
    role: cleanRole(raw.role),
    color: colorFor(username, typeof raw.color === 'string' ? raw.color : undefined),
    active: raw.active !== false,
    description: description && isKidSafe(description) ? description : '',
    talkativeness: clampSlider(raw.talkativeness, 50),
    positivity: clampSlider(raw.positivity, 60),
    hype: clampSlider(raw.hype, 40),
    trolling: clampSlider(raw.trolling, 15),
    presence: clampSlider(raw.presence, 50),
    emoji: clampSlider(raw.emoji, 30),
    caps: clampSlider(raw.caps, 20),
    slang: clampSlider(raw.slang, 30),
    phrases: cleanList(raw.phrases, 8),
    topics: cleanList(raw.topics, 8)
  }
}

export function sanitizeCrowd(value: unknown): CustomCrowd {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const viewers: CustomViewer[] = []
  const source = Array.isArray(raw.viewers) ? raw.viewers : []
  for (const item of source) {
    const viewer = sanitizeViewer(item, viewers.length)
    if (!viewer) continue
    if (viewers.some((have) => have.id === viewer.id || have.username.toLowerCase() === viewer.username.toLowerCase())) continue
    viewers.push(viewer)
    if (viewers.length >= 24) break
  }
  return { viewers, randomNames: cleanList(raw.randomNames, 40).map((name) => cleanName(name)).filter(Boolean) }
}

export function haterPreset(): CustomViewer[] {
  const seeds = [
    ['meh_mode', 'thinks every play is a little mid', ['that was mid', 'not the play']],
    ['side_eye', 'light tease, never mean', ['hmm sure', 'questionable']],
    ['skill_check', 'points out mistakes kindly', ['skill issue but kind', 'we can do better']]
  ] as const
  return seeds.map(([username, description, phrases], index) => ({
    ...blankViewer(`preset-hater-${index + 1}`, username),
    role: 'hater' as const,
    description,
    positivity: 25,
    trolling: 55,
    hype: 20,
    phrases: [...phrases],
    topics: ['the run']
  }))
}

export function addHaters(crowd: CustomCrowd): CustomCrowd {
  const next = sanitizeCrowd(crowd)
  for (const viewer of haterPreset()) {
    if (next.viewers.some((have) => have.id === viewer.id || have.username.toLowerCase() === viewer.username.toLowerCase())) continue
    next.viewers.push(viewer)
  }
  return next
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

export function pickCustom(viewers: readonly CustomViewer[], rng: () => number, used: Set<string>): CustomViewer | null {
  const pool = viewers.filter((viewer) => viewer.active && !used.has(viewer.username.toLowerCase()) && isKidSafe(viewer.username))
  if (!pool.length) return null
  const weights = pool.map((viewer) => Math.max(1, Math.round(((viewer.presence + 10) / 110) * ((viewer.talkativeness + 15) / 115) * 12)))
  let roll = rng() * weights.reduce((sum, weight) => sum + weight, 0)
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i] ?? 0
    if (roll <= 0) return pool[i] ?? null
  }
  return pool[0] ?? null
}

export function viewerLine(viewer: CustomViewer, rng: () => number, keywords: string[]): string {
  const phrases = viewer.phrases.filter((phrase) => isKidSafe(phrase))
  const topics = viewer.topics.filter((topic) => isKidSafe(topic))
  const keyword = keywords.find((word) => isKidSafe(word)) ?? ''
  let line = ''
  if (phrases.length && rng() < 0.55) line = pick(phrases, rng)
  else if (viewer.role === 'lurker' || viewer.talkativeness < 25) line = pick(LURK, rng)
  else if (viewer.role === 'hater' || viewer.positivity < 35 || viewer.trolling > 70) line = pick(TEASE, rng)
  else if (viewer.role === 'backseat') {
    const tip = pick(ADVICE, rng)
    const topic = topics[0]
    line = topic ? `${tip} around ${topic}` : tip
  } else if (keyword && rng() < 0.5) line = `${pick(HYPE, rng)} ${keyword}`
  else line = topics.length && rng() < 0.4 ? `${pick(HYPE, rng)} ${pick(topics, rng)}` : pick(HYPE, rng)
  if (viewer.role === 'hyper' || viewer.hype > 75) line = stretchWord(line.split(' ')[0] || line)
  if ((viewer.role === 'hyper' || viewer.caps > 70) && rng() < 0.7) line = line.toUpperCase()
  if (viewer.emoji > 60) line = `${line} ${pick(EMOTES, rng)}`
  if (viewer.slang > 65 && rng() < 0.6) line = `${line} fr`
  if (viewer.role === 'hater' && viewer.trolling > 40 && rng() < 0.3) line = letterSpam(line)
  const clipped = line.replace(/[ \t]+/g, ' ').trim().slice(0, 180)
  return clipped && isKidSafe(clipped) ? clipped : 'nice'
}

export function customPromptBlock(viewers: readonly CustomViewer[], randomNames: readonly string[] = []): string {
  const active = viewers.filter((viewer) => viewer.active).slice(0, 12)
  const names = randomNames.filter((name) => isKidSafe(name)).slice(0, 20)
  if (!active.length && !names.length) return ''
  const lines = active.map((viewer) => {
    const bits = [
      `${viewer.username} (${viewer.role})`,
      viewer.description,
      viewer.phrases.slice(0, 2).join(' / '),
      viewer.topics.slice(0, 3).join(', ')
    ].filter(Boolean)
    return `- ${bits.join(' | ')}`
  })
  const extra = names.length ? `Extra usernames that may appear: ${names.join(', ')}.` : ''
  return [
    'Recurring viewers are in this chat. Their usernames are allowed even when other messages need new names. Stay in character. Haters only tease lightly: no swearing, slurs, or cruelty.',
    ...lines,
    extra
  ]
    .filter(Boolean)
    .join('\n')
}
