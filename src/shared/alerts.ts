import { colorFor } from './color'
import { isKidSafe } from './filter'
import { makeId } from './ids'
import type { AlertFrequency, ChatMessage, MessageKind, SoundPack } from './types'
import { makeUsername } from './usernames'

const NOTES = [
  'you carried that',
  'for the clip',
  'get a snack',
  'that was worth it',
  'keep going',
  'love the stream',
  'so much fun',
  'lets go'
]

const REACTIONS: Record<string, string[]> = {
  donation: ['POG', 'thank you for the donation!!', 'W donation', 'chat is fed'],
  sub: ['welcome to the subs', 'POG', 'thank you for the sub!!'],
  bits: ['cheers!!', 'POG', 'thank you for the bits!!'],
  gift: ['gifted subs lets go', 'thank you for the gifts!!', 'POG'],
  raid: ['raid hype', 'welcome raiders!!', 'POG']
}

export interface AlertDraft {
  message: ChatMessage
  reactions: ChatMessage[]
  viewerBump: number
  sound: SoundPack
  speak: string | null
}

export function alertIntervalMs(frequency: AlertFrequency, rng: () => number = Math.random): number {
  const base = frequency === 'rare' ? 70_000 : frequency === 'often' ? 12_000 : 28_000
  return Math.round(base * (0.75 + rng() * 0.5))
}

export function viewerBumpFor(kind: MessageKind, amount: number, raidViewers = 0): number {
  if (kind === 'raid') return Math.min(500, Math.max(1, Math.round(raidViewers || amount || 1)))
  if (kind === 'donation') return 2 + Math.min(40, Math.round(amount / 5))
  if (kind === 'bits') return 2 + Math.min(30, Math.round(amount / 100))
  if (kind === 'gift') return 3 + Math.min(20, Math.round(amount))
  return 2
}

export function cleanCurrency(value: string): string {
  const trimmed = value.replace(/[^\w$€£¥]/g, '').slice(0, 4)
  return trimmed || '$'
}

export function formatAlertAmount(currency: string, amount: number, kind: MessageKind): string {
  const rounded = Math.max(1, Math.round(amount))
  if (kind === 'bits') return `${rounded} bits`
  if (kind === 'gift') return `${rounded} gifted`
  if (kind === 'raid') return ''
  const cur = cleanCurrency(currency)
  return cur === '$' || cur === '€' || cur === '£' || cur === '¥' ? `${cur}${rounded}` : `${cur} ${rounded}`
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))] as T
}

function amountIn(min: number, max: number, rng: () => number): number {
  const lo = Math.max(1, Math.round(Math.min(min, max)))
  const hi = Math.max(lo, Math.round(Math.max(min, max)))
  return lo + Math.floor(rng() * (hi - lo + 1))
}

function safeNote(rng: () => number): string {
  const note = pick(NOTES, rng)
  return isKidSafe(note) ? note : 'keep going'
}

export function rollAlert(
  input: {
    min: number
    max: number
    currency: string
    sound: SoundPack
    tts: boolean
    rng?: () => number
    now?: number
    avoid?: Set<string>
  }
): AlertDraft {
  const rng = input.rng ?? Math.random
  const now = input.now ?? Date.now()
  const avoid = input.avoid ?? new Set<string>()
  const roll = rng()
  const kind: MessageKind = roll < 0.4 ? 'donation' : roll < 0.58 ? 'sub' : roll < 0.74 ? 'bits' : roll < 0.86 ? 'gift' : 'raid'
  const username = makeUsername(rng, avoid)
  const rawAmount = kind === 'bits' ? amountIn(20, 500, rng) : kind === 'gift' ? amountIn(1, 10, rng) : kind === 'raid' ? amountIn(8, 180, rng) : amountIn(input.min, input.max, rng)
  const amount = formatAlertAmount(input.currency, rawAmount, kind)
  const months = amountIn(1, 12, rng)
  const text =
    kind === 'sub'
      ? months === 1
        ? 'subscribed'
        : `subscribed for ${months} months`
      : kind === 'raid'
        ? 'incoming raid'
        : kind === 'gift'
          ? 'gifted a sub'
          : kind === 'bits'
            ? 'cheered'
            : safeNote(rng)
  const message: ChatMessage = {
    id: makeId(now, rng),
    username,
    badge: kind === 'sub' || kind === 'gift' ? 'sub' : null,
    color: colorFor(username),
    text: isKidSafe(text) ? text : 'keep going',
    kind,
    amount: amount || undefined,
    viewers: kind === 'raid' ? rawAmount : undefined
  }
  return {
    message,
    reactions: reactionMessages(kind, rng, now, avoid, username),
    viewerBump: viewerBumpFor(kind, rawAmount, kind === 'raid' ? rawAmount : 0),
    sound: input.sound,
    speak: speechLine(message, input.tts)
  }
}

export function sampleDonation(currency: string, sound: SoundPack, tts: boolean, now = Date.now()): AlertDraft {
  const message: ChatMessage = {
    id: makeId(now, () => 0.2),
    username: 'TestDonor',
    badge: null,
    color: colorFor('TestDonor'),
    text: 'this is a test donation',
    kind: 'donation',
    amount: formatAlertAmount(currency, 5, 'donation')
  }
  return {
    message,
    reactions: reactionMessages('donation', () => 0.1, now, new Set(['testdonor']), 'TestDonor'),
    viewerBump: viewerBumpFor('donation', 5),
    sound,
    speak: speechLine(message, tts)
  }
}

export function alertReaction(kind: MessageKind, rng: () => number = Math.random): string {
  const bank = REACTIONS[kind] ?? REACTIONS.donation ?? ['POG']
  const line = pick(bank, rng)
  return isKidSafe(line) ? line : 'POG'
}

function reactionMessages(kind: MessageKind, rng: () => number, now: number, avoid: Set<string>, donor: string): ChatMessage[] {
  const bank = REACTIONS[kind] ?? REACTIONS.donation
  const lines = [pick(bank, rng), pick(bank, rng)].filter((line, index, all) => all.indexOf(line) === index)
  return lines
    .filter((line) => isKidSafe(line))
    .slice(0, 2)
    .map((text, index) => {
      const username = makeUsername(rng, avoid)
      avoid.add(username.toLowerCase())
      return {
        id: makeId(now + index + 1, rng),
        username,
        badge: null,
        color: colorFor(username),
        text: text === 'POG' && index === 0 ? 'POG' : text.includes(donor) ? text : text,
        kind: 'chat' as const
      }
    })
}

export function speechLine(message: ChatMessage, tts: boolean): string | null {
  if (!tts) return null
  const amount = message.amount ? ` ${message.amount}` : ''
  const viewers = message.kind === 'raid' && message.viewers ? ` with ${message.viewers} viewers` : ''
  const text = `${message.username} ${message.kind === 'donation' ? `donated${amount}` : message.kind === 'raid' ? `is raiding${viewers}` : message.text}. ${message.kind === 'chat' ? '' : message.text}`.replace(/\s+/g, ' ').trim()
  return isKidSafe(text) ? text.slice(0, 180) : null
}

export function allowSyntheticChat(mix: 'real' | 'mixed', liveActive: boolean): boolean {
  return mix !== 'real' || !liveActive
}
