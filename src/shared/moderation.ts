import { colorFor } from './color'
import { makeId } from './ids'
import type { ChatMessage } from './types'

export type ModTarget = 'named' | 'recent' | 'spammer' | 'everyone'

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

const COMMAND = /\b(?:please\s+)?(?:mods?\s+)?(?:please\s+)?(ban|banned|band|timeout|time out)\b\s+(.+)$/

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
  if (/^(everyone|everybody|all|all of them|everybody else)$/.test(core)) return { target: 'everyone' }
  if (/^(all (the )?(bots|viewers|chat|of them|them)|the bots|every (bot|viewer|one))$/.test(core)) {
    return { target: 'everyone' }
  }
  if (/^(him|her|them|that guy|that dude|this guy|this dude|the guy|that person|that one|this person|the last guy|last guy|the last one|last one|the last dude|that last guy)$/.test(core)) {
    return { target: 'recent' }
  }
  if (/^(the )?(last|latest) (guy|dude|person|one|viewer|chatter|man)$/.test(core)) return { target: 'recent' }
  const spoken = core.replace(/^(the|a)\s+/, '').trim()
  if (!spoken) return { target: 'recent' }
  return { target: 'named', spokenName: spoken }
}

export function formatModCommand(command: ModCommand): string {
  const name = command.spokenName ? ` ${command.spokenName}` : ''
  return `${command.action} ${command.target}${name}`
}

export function nameKey(value: string): string {
  let text = value.toLowerCase().replace(/^x+_+/, '')
  text = text.replace(/[^a-z0-9]/g, '')
  text = text.replace(/\d+/g, '')
  text = text.replace(/^xx+/, '')
  return text
}

export function phoneticKey(value: string): string {
  let text = nameKey(value)
  if (!text) text = value.toLowerCase().replace(/[^a-z]/g, '')
  text = text.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/qu/g, 'k')
  text = text.replace(/[aeiouy]/g, '')
  text = text.replace(/(.)\1+/g, '$1')
  return text
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

function nameScore(chatterName: string, spoken: string): number | null {
  const norm = normalizeName(chatterName)
  const target = normalizeName(spoken)
  const coreA = nameKey(chatterName)
  const coreB = nameKey(spoken)
  if (!norm || !target) return null
  if (norm === target || (coreA.length > 0 && coreA === coreB)) return 0
  const phoneA = phoneticKey(coreA)
  const phoneB = phoneticKey(coreB)
  if (phoneA.length >= 3 && phoneA === phoneB) return 1
  const left = coreA || norm
  const right = coreB || target
  const dist = levenshtein(left, right)
  const limit = Math.max(1, Math.floor(Math.max(left.length, right.length) / 4))
  if (dist <= limit) return dist
  if (right.length >= 3 && (left.includes(right) || right.includes(left))) {
    const extra = Math.abs(left.length - right.length)
    if (extra <= 6) return dist + extra
  }
  return null
}

function poolFor(command: ModCommand, chatters: Chatter[]): Chatter[] {
  if (command.target === 'named' || command.target === 'everyone') return chatters
  const regular = chatters.filter((chatter) => !chatter.mod)
  return regular.length ? regular : chatters
}

export function resolveModTarget(command: ModCommand, chatters: Chatter[]): string | null {
  if (command.target === 'everyone') return null
  if (command.target === 'named') {
    let best: { name: string; score: number; recent: number } | null = null
    const spoken = command.spokenName ?? ''
    for (const chatter of chatters) {
      const score = nameScore(chatter.name, spoken)
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

export function resolveModTargets(command: ModCommand, chatters: Chatter[]): string[] {
  if (command.target === 'everyone') {
    const regular = chatters.filter((chatter) => !chatter.mod)
    const source = regular.length ? regular : chatters
    const names: string[] = []
    for (const chatter of source) {
      if (!names.some((name) => name.toLowerCase() === chatter.name.toLowerCase())) names.push(chatter.name)
    }
    return names.slice(0, 12)
  }
  const one = resolveModTarget(command, chatters)
  return one ? [one] : []
}

export function mergeChatters(groups: Chatter[][]): Chatter[] {
  const map = new Map<string, Chatter>()
  for (const group of groups) {
    for (const chatter of group) {
      if (!chatter.name) continue
      const key = chatter.name.toLowerCase()
      const prev = map.get(key)
      if (!prev) {
        map.set(key, { ...chatter })
        continue
      }
      prev.spam = Math.max(prev.spam, chatter.spam)
      prev.recentIndex = Math.max(prev.recentIndex, chatter.recentIndex)
      prev.mod = prev.mod || chatter.mod
    }
  }
  return [...map.values()]
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

export function buildMassBan(input: {
  targets: string[]
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
  if (!input.targets.length) return [modLine('who should I ban')]
  const messages: ChatMessage[] = [modLine(input.targets.length > 1 ? 'banned everyone' : `banned ${input.targets[0]}`)]
  input.targets.forEach((target, index) => {
    messages.push({
      id: makeId(input.now + index + 1, input.rng),
      username: 'modbot',
      badge: null,
      color: '#d7deea',
      text: `${target} has been banned`,
      kind: 'system',
      purgeUser: target
    })
  })
  return messages
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
