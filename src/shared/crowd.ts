import { colorFor } from './color'
import type { Badge } from './types'
import { makeUsername } from './usernames'

export const BORED_LINES = [
  'lol bored',
  'gn',
  'brb',
  'this is kinda slow',
  'im heading out',
  'brb maybe',
  'chat is sleepy',
  'nothing is happening',
  'zzz',
  'ill be back if it gets good',
  'stream is looping',
  'ok gn',
  'bored lol',
  'gonna dip',
  'wake me up when something happens'
]

export interface CrowdViewer {
  name: string
  badge: Badge
  color: string
  engagement: number
  spam: number
}

export interface Crowd {
  count: number
  viewers: CrowdViewer[]
  boredom: number
  lastSpeechAt: number
  lastScreenAt: number
  lastScreenChange: number
  recentTexts: string[]
  repetitive: number
}

export interface CrowdTick {
  now: number
  idle: boolean
  micLive: boolean
  rng: () => number
}

export interface CrowdEvent {
  type: 'leave' | 'join'
  name: string
  badge: Badge
  color: string
  text?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

export function formatViewerCount(count: number): string {
  const n = Math.max(0, Math.round(count))
  return n.toLocaleString('en-US')
}

export function createCrowd(rng: () => number, now: number): Crowd {
  const count = 42 + Math.floor(rng() * 150)
  const viewers: CrowdViewer[] = []
  const avoid = new Set<string>()
  const named = 7 + Math.floor(rng() * 4)
  for (let i = 0; i < named; i++) {
    const name = makeUsername(rng, avoid)
    avoid.add(name.toLowerCase())
    const roll = rng()
    const badge: Badge = i === 0 ? 'mod' : roll < 0.08 ? 'mod' : roll < 0.18 ? 'vip' : roll < 0.34 ? 'sub' : null
    viewers.push({
      name,
      badge,
      color: colorFor(name),
      engagement: 0.45 + rng() * 0.5,
      spam: 0
    })
  }
  return {
    count,
    viewers,
    boredom: 0.18,
    lastSpeechAt: now,
    lastScreenAt: now,
    lastScreenChange: 0.35,
    recentTexts: [],
    repetitive: 0
  }
}

export function boredomTarget(crowd: Crowd, input: { now: number; idle: boolean; micLive: boolean }): number {
  const silent = input.now - crowd.lastSpeechAt
  const sinceScreen = input.now - crowd.lastScreenAt
  let target = 0.15
  if (input.idle) target += 0.28
  if (silent > 45_000) target += 0.27
  if (silent > 120_000) target += 0.15
  if (sinceScreen > 25_000 && crowd.lastScreenChange < 0.12) target += 0.25
  if (crowd.repetitive > 0.55) target += 0.22
  if (input.micLive || silent < 10_000) target -= 0.45
  if (crowd.lastScreenChange >= 0.45 && sinceScreen < 20_000) target -= 0.35
  return clamp(target, 0, 1)
}

export function chatSlots(crowd: Crowd): number {
  if (crowd.boredom >= 0.82) return 0
  if (crowd.boredom >= 0.58) return 1
  return crowd.boredom <= 0.22 ? 3 : 2
}

export function noteChatLine(crowd: Crowd, text: string): void {
  const key = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!key) return
  crowd.recentTexts.push(key)
  if (crowd.recentTexts.length > 8) crowd.recentTexts.shift()
  const unique = new Set(crowd.recentTexts).size
  crowd.repetitive = 1 - unique / crowd.recentTexts.length
}

export function markTalking(crowd: Crowd, now: number): void {
  crowd.lastSpeechAt = now
  crowd.boredom = Math.max(0, crowd.boredom - 0.2)
  crowd.count = Math.min(99_999, crowd.count + 2)
  for (const viewer of crowd.viewers) viewer.engagement = Math.min(1, viewer.engagement + 0.08)
}

export function noteScreen(crowd: Crowd, change: number, now: number): void {
  crowd.lastScreenChange = clamp(change, 0, 1)
  crowd.lastScreenAt = now
  if (change >= 0.45) {
    crowd.boredom = Math.max(0, crowd.boredom - 0.25)
    crowd.count = Math.min(99_999, crowd.count + 3)
    for (const viewer of crowd.viewers) viewer.engagement = Math.min(1, viewer.engagement + 0.1)
    return
  }
  if (change < 0.1) crowd.boredom = Math.min(1, crowd.boredom + 0.05)
}

export function banViewer(crowd: Crowd, name: string): void {
  const key = name.toLowerCase()
  const index = crowd.viewers.findIndex((viewer) => viewer.name.toLowerCase() === key)
  if (index >= 0) crowd.viewers.splice(index, 1)
  crowd.count = Math.max(1, crowd.count - 1)
}

export function tickCrowd(crowd: Crowd, input: CrowdTick): CrowdEvent[] {
  const events: CrowdEvent[] = []
  const silent = input.now - crowd.lastSpeechAt
  const sinceScreen = input.now - crowd.lastScreenAt
  const target = boredomTarget(crowd, input)
  crowd.boredom = clamp(crowd.boredom * 0.55 + target * 0.45, 0, 1)
  const boring = crowd.boredom >= 0.55
  for (const viewer of crowd.viewers) {
    viewer.engagement = boring
      ? Math.max(0, viewer.engagement - 0.12)
      : Math.min(1, viewer.engagement + 0.1)
  }

  let delta = Math.floor(input.rng() * 5) - 2
  if (input.micLive || silent < 10_000) delta += 2 + Math.floor(input.rng() * 3)
  if (crowd.lastScreenChange >= 0.4 && sinceScreen < 12_000) delta += 2 + Math.floor(input.rng() * 4)
  if (crowd.boredom >= 0.55) delta -= 2 + Math.floor(input.rng() * 3)
  crowd.count = clamp(crowd.count + delta, 1, 99_999)

  const active = input.micLive || silent < 12_000 || (crowd.lastScreenChange >= 0.45 && sinceScreen < 15_000)
  if (active && crowd.viewers.length < 18 && input.rng() < 0.45) {
    const avoid = new Set(crowd.viewers.map((viewer) => viewer.name.toLowerCase()))
    const name = makeUsername(input.rng, avoid)
    const roll = input.rng()
    const badge: Badge = roll < 0.08 ? 'mod' : roll < 0.18 ? 'vip' : roll < 0.32 ? 'sub' : null
    const viewer: CrowdViewer = {
      name,
      badge,
      color: colorFor(name),
      engagement: 0.72,
      spam: 0
    }
    crowd.viewers.push(viewer)
    crowd.count = Math.min(99_999, crowd.count + 1 + Math.floor(input.rng() * 3))
    events.push({ type: 'join', name, badge, color: viewer.color })
  }

  if (crowd.boredom > 0.6 && crowd.viewers.length > 4 && input.rng() < 0.55) {
    const pool = crowd.viewers.filter((viewer) => viewer.badge !== 'mod' && viewer.engagement < 0.45)
    pool.sort((a, b) => a.engagement - b.engagement)
    const victim = pool[0]
    if (victim) {
      crowd.viewers = crowd.viewers.filter((viewer) => viewer !== victim)
      crowd.count = Math.max(1, crowd.count - 1)
      events.push({
        type: 'leave',
        name: victim.name,
        badge: victim.badge,
        color: victim.color,
        text: pick(BORED_LINES, input.rng)
      })
    }
  }

  return events
}
