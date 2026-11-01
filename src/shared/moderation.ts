import { colorFor } from './color'
import { makeId } from './ids'
import type { ChatMessage } from './types'

export type ModTarget = 'named' | 'recent' | 'spammer'

export interface ModCommand {
  action: 'ban' | 'timeout'
  target: ModTarget
  spokenName?: string
}

export interface Chatter {
  name: string
  spam: number
  recentIndex: number
  mod?: boolean
}

const COMMAND = /\b(?:mods?\s+)?(?:please\s+)?(ban|banned|timeout|time out)\b\s+(.+)$/

export function parseModCommand(text: string): ModCommand | null {
  const clean = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return null
  const match = clean.match(COMMAND)
  if (!match?.[1] || !match[2]) return null
  const action = match[1].startsWith('time') || match[1] === 'timeout' ? 'timeout' : 'ban'
  return { action, ...classifyTarget(match[2]) }
}

function classifyTarget(rest: string): Pick<ModCommand, 'target' | 'spokenName'> {
  const core = rest
    .replace(/\b(please|now|thanks|pls|tho|though)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^(the\s+)?(spammer|spam|spammers)$/.test(core)) return { target: 'spammer' }
  if (/^(him|her|them|that guy|that dude|this guy|this dude|the guy|that person|that one|this person)$/.test(core)) {
    return { target: 'recent' }
  }
  const spoken = core.replace(/^(the|a)\s+/, '').trim()
  if (!spoken) return { target: 'recent' }
  return { target: 'named', spokenName: spoken }
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function levenshtein(left: string, right: string): number {
  const rows = left.length + 1
  const cols = right.length + 1
  const grid: number[][] = []
  for (let r = 0; r < rows; r++) {
    const row: number[] = []
    for (let c = 0; c < cols; c++) row.push(r === 0 ? c : c === 0 ? r : 0)
    grid.push(row)
  }
  for (let r = 1; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      const cost = left[r - 1] === right[c - 1] ? 0 : 1
      const insert = (grid[r - 1]?.[c] ?? 0) + 1
      const remove = (grid[r]?.[c - 1] ?? 0) + 1
      const replace = (grid[r - 1]?.[c - 1] ?? 0) + cost
      const row = grid[r]
      if (row) row[c] = Math.min(insert, remove, replace)
    }
  }
  return grid[left.length]?.[right.length] ?? Math.max(left.length, right.length)
}

function nameScore(norm: string, target: string): number | null {
  if (!norm || !target) return null
  if (norm === target) return 0
  const dist = levenshtein(norm, target)
  const limit = Math.max(1, Math.floor(Math.max(norm.length, target.length) / 4))
  if (dist <= limit) return dist
  if (target.length >= 4 && (norm.includes(target) || target.includes(norm))) {
    const extra = Math.abs(norm.length - target.length)
    if (extra <= 4) return dist + extra
  }
  return null
}

function poolFor(command: ModCommand, chatters: Chatter[]): Chatter[] {
  if (command.target === 'named') return chatters
  const regular = chatters.filter((chatter) => !chatter.mod)
  return regular.length ? regular : chatters
}

export function resolveModTarget(command: ModCommand, chatters: Chatter[]): string | null {
  if (command.target === 'named') {
    let best: { name: string; score: number; recent: number } | null = null
    const spoken = command.spokenName ?? ''
    const target = normalizeName(spoken)
    for (const chatter of chatters) {
      const score = nameScore(normalizeName(chatter.name), target)
      if (score === null) continue
      if (!best || score < best.score || (score === best.score && chatter.recentIndex > best.recent)) {
        best = { name: chatter.name, score, recent: chatter.recentIndex }
      }
    }
    return best?.name ?? null
  }
  const pool = poolFor(command, chatters).filter((chatter) => chatter.recentIndex >= 0 || chatter.spam > 0)
  if (!pool.length) return null
  if (command.target === 'spammer') {
    pool.sort((a, b) => b.spam - a.spam || b.recentIndex - a.recentIndex)
    return pool[0]?.name ?? null
  }
  pool.sort((a, b) => b.recentIndex - a.recentIndex)
  return pool[0]?.name ?? null
}

export function speakerOf(line: string): string {
  const index = line.indexOf(':')
  return index === -1 ? '' : line.slice(0, index).trim()
}

export function withoutChatter(lines: string[], name: string): string[] {
  const key = name.toLowerCase()
  return lines.filter((line) => speakerOf(line).toLowerCase() !== key)
}

const MOD_LINES = [
  'got it, {name} is out',
  '{name} is banned',
  'say less',
  'banned {name}',
  'yeah they are gone',
  'mods got {name}'
]

export function buildModeration(input: {
  target: string | null
  modName: string
  modColor?: string
  rng: () => number
  now: number
}): ChatMessage[] {
  const color = input.modColor || colorFor(input.modName)
  const modLine = (text: string): ChatMessage => ({
    id: makeId(input.now, input.rng),
    username: input.modName,
    badge: 'mod',
    color,
    text,
    kind: 'chat'
  })
  if (!input.target) return [modLine('who should I ban')]
  const template = MOD_LINES[Math.min(MOD_LINES.length - 1, Math.floor(input.rng() * MOD_LINES.length))] ?? MOD_LINES[0]
  const text = template.replaceAll('{name}', input.target)
  return [
    modLine(text),
    {
      id: makeId(input.now + 1, input.rng),
      username: 'modbot',
      badge: null,
      color: '#d7deea',
      text: `${input.target} has been banned`,
      kind: 'system',
      purgeUser: input.target
    }
  ]
}

export function spamBump(previous: string | undefined, text: string): number {
  let bump = 0
  const normalized = text.trim().toLowerCase()
  if (previous && previous === normalized) bump += 3
  if (text.length > 5 && text === text.toUpperCase() && /[A-Z]/.test(text)) bump += 2
  const emotes = text.match(/[😂🔥💀👏😭✨❤️🎮]/gu)
  if (emotes && emotes.length >= 3) bump += 2
  if (/(.)\1{4,}/.test(text)) bump += 1
  return bump
}
