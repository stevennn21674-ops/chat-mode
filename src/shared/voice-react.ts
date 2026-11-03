import { colorFor } from './color'
import { badgeOf, viewerLine, type CustomViewer } from './custom-viewers'
import { isKidSafe } from './filter'
import { echoWords } from './local-chat'
import { detectIntent, nluLine, type IntentHit } from './nlu'
import { groundedLines } from './ocr-text'
import type { ScheduledMessage } from './schedule'
import type { Badge, ChatMessage } from './types'
import { makeUsername } from './usernames'

export interface VoiceScene {
  title: string | null
  game: string | null
  colors: string[]
  kind: 'menu' | 'gameplay' | 'dark' | 'loading' | 'cut' | 'unknown'
  motion: 'still' | 'moving' | 'fast'
  ocr: string
  textLike: boolean
  warm: boolean
}

export interface VoiceSpeaker {
  name: string
  badge: Badge
  color: string
  custom?: CustomViewer
}

export function voiceReplyCount(text: string, busyCpu = false): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  let count = 4
  if (words >= 16) count = 6
  if (words >= 28) count = 8
  if (busyCpu) count = Math.max(3, count - 2)
  return count
}

export function speechParts(text: string): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (!words.length) return []
  if (words.length <= 14) return [words.join(' ')]
  const chunks = Math.min(3, Math.ceil(words.length / 12))
  const size = Math.ceil(words.length / chunks)
  const parts: string[] = []
  for (let i = 0; i < words.length; i += size) parts.push(words.slice(i, i + size).join(' '))
  return parts.slice(0, 3)
}

export function sceneCaption(scene: VoiceScene): string {
  const bits: string[] = []
  if (scene.kind === 'menu') bits.push('menu or a still screen')
  else if (scene.kind === 'loading') bits.push('a loading screen')
  else if (scene.kind === 'dark') bits.push('a dark screen')
  else if (scene.kind === 'cut') bits.push('a sudden change')
  else if (scene.kind === 'gameplay') bits.push(scene.motion === 'fast' ? 'fast gameplay' : 'gameplay')
  if (scene.game) bits.push(scene.game)
  else if (scene.title) bits.push(scene.title)
  if (scene.colors[0]) bits.push(`mostly ${scene.colors[0]}`)
  if (scene.warm) bits.push('warm colors up close')
  if (scene.ocr) bits.push(`text: ${scene.ocr.slice(0, 80)}`)
  else if (scene.textLike) bits.push('writing on the screen')
  return bits.join(', ').slice(0, 180)
}

export function silenceLines(game: string | null): string[] {
  if (game && isKidSafe(game)) return ['say something', 'chat is waiting', `how is ${game} going?`]
  return ['say something', 'chat is waiting', 'what are you playing?']
}

export function stickForScroll(autoScroll: boolean, distanceFromBottom: number): boolean {
  if (!autoScroll) return false
  return distanceFromBottom <= 16
}

function bounds(count: number): { quickEnd: number; fullEnd: number } {
  const followStart = Math.max(1, count - 2)
  const quickEnd = Math.max(1, Math.min(followStart, Math.ceil(followStart / 2)))
  return { quickEnd, fullEnd: followStart }
}

function phaseOf(index: number, count: number): 'quick' | 'full' | 'follow' {
  const { quickEnd, fullEnd } = bounds(count)
  if (index < quickEnd) return 'quick'
  if (index < fullEnd) return 'full'
  return 'follow'
}

function clip(text: string, max = 48): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function safeLine(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 160)
  return clean && isKidSafe(clean) ? clean : 'nice'
}

export function scheduleVoiceReactions(messages: ChatMessage[], now: number): ScheduledMessage[] {
  const count = messages.length
  if (!count) return []
  const { quickEnd, fullEnd } = bounds(count)
  return messages.map((message, index) => {
    let at = now + 200
    if (index < quickEnd) at = now + 180 + Math.round((index * 1100) / quickEnd)
    else if (index < fullEnd) {
      const span = Math.max(1, fullEnd - quickEnd)
      at = now + 1800 + Math.round(((index - quickEnd) * 3800) / span)
    } else {
      const span = Math.max(1, count - fullEnd)
      at = now + 6200 + Math.round(((index - fullEnd) * 3200) / span)
    }
    return { at, message }
  })
}

function speakerAt(
  index: number,
  input: { roster: VoiceSpeaker[]; custom: CustomViewer[]; rng: () => number; avoid: Set<string> },
  used: Set<string>
): VoiceSpeaker {
  const custom = input.custom.find((viewer) => viewer.active && isKidSafe(viewer.username) && !used.has(viewer.username.toLowerCase()))
  if (custom && (index === 1 || index === 4)) {
    return { name: custom.username, badge: badgeOf(custom.role), color: custom.color, custom }
  }
  const mod = input.roster.find((person) => person.badge === 'mod' && !used.has(person.name.toLowerCase()))
  if (mod && (index === 0 || index === 2)) return mod
  const roster = input.roster.find((person) => !used.has(person.name.toLowerCase()))
  if (roster && input.rng() < 0.85) return roster
  const name = makeUsername(input.rng, new Set([...input.avoid, ...used]))
  return { name, badge: null, color: colorFor(name) }
}

function lineFor(
  index: number,
  count: number,
  part: string,
  intent: IntentHit,
  scene: VoiceScene | null,
  earlier: string[],
  speaker: VoiceSpeaker,
  previous: ChatMessage | null,
  keywords: string[]
): string {
  const phase = phaseOf(index, count)
  const focus = intent.focus && intent.focus !== 'that' ? intent.focus : keywords[0] || 'that'
  const screen = scene ? groundedLines({ ocr: scene.ocr, colors: scene.colors, game: scene.game, kind: scene.kind }) : []
  if (speaker.custom && phase !== 'follow') {
    const spoken = viewerLine(speaker.custom, () => 0.2, keywords)
    const word = keywords[0]
    if (word && !spoken.toLowerCase().includes(word.toLowerCase())) return `${spoken} ${word}`
    return spoken
  }
  if (phase === 'quick') {
    if (index === 0 && (intent.intent === 'question' || intent.intent === 'ask-chat') && screen[0]) return screen[0]
    if (intent.intent === 'greeting') return 'hey hey'
    if (intent.intent === 'question' || intent.intent === 'ask-chat') {
      return nluLine({ rng: () => 0.2, intent: intent.intent, focus, keywords })
    }
    if (screen[index] && index < 2) return screen[index]
    const word = echoWords([part])[0]
    if (word) return `they said ${word}`
    return 'yo I heard you'
  }
  if (phase === 'full') {
    if (intent.intent === 'compliment' || intent.intent === 'win') return 'so true'
    if (intent.intent === 'insult' || intent.intent === 'lose') return 'hmm I disagree'
    if (screen[1] && index % 2 === 0) return screen[1]
    const word = echoWords([part])[0]
    if (word) return `wait ${word}`
    return nluLine({ rng: () => 0.4, intent: intent.intent === 'none' ? 'question' : intent.intent, focus, keywords })
  }
  if (earlier.length && index === count - 1) return `earlier you said ${clip(earlier[earlier.length - 1] ?? '')}`
  if (previous) return `${previous.username} yeah but ${focus}?`
  return `wait what about ${focus}?`
}

export function buildVoiceReactions(input: {
  transcript: string
  earlier?: string[]
  scene?: VoiceScene | null
  rng?: () => number
  avoid?: Set<string>
  roster?: VoiceSpeaker[]
  custom?: CustomViewer[]
  now?: number
  busyCpu?: boolean
}): ChatMessage[] {
  const transcript = input.transcript.replace(/\s+/g, ' ').trim().slice(0, 400)
  if (transcript.length < 2) return []
  const rng = input.rng ?? Math.random
  const count = voiceReplyCount(transcript, input.busyCpu ?? false)
  const parts = speechParts(transcript)
  const names = [...(input.roster ?? []).map((person) => person.name), ...(input.custom ?? []).map((viewer) => viewer.username)]
  const intent = detectIntent(transcript, { names })
  const keywords = echoWords([transcript, input.scene?.ocr ?? '', input.scene?.game ?? ''])
  const avoid = input.avoid ?? new Set<string>()
  const used = new Set<string>()
  const speakers: VoiceSpeaker[] = []
  for (let index = 0; index < count; index += 1) {
    const speaker = speakerAt(index, { roster: input.roster ?? [], custom: input.custom ?? [], rng, avoid }, used)
    used.add(speaker.name.toLowerCase())
    avoid.add(speaker.name.toLowerCase())
    speakers.push(speaker)
  }
  const now = input.now ?? Date.now()
  const messages: ChatMessage[] = []
  for (let index = 0; index < count; index += 1) {
    const speaker = speakers[index] ?? speakers[0]
    if (!speaker) continue
    const part = parts[index % Math.max(1, parts.length)] ?? transcript
    let text = lineFor(index, count, part, intent, input.scene ?? null, input.earlier ?? [], speaker, messages[messages.length - 1] ?? null, keywords)
    if (speaker.badge === 'mod' && !text.toLowerCase().startsWith('chat ')) text = `chat ${text}`
    messages.push({
      id: `vox-${now}-${index}`,
      username: speaker.name,
      badge: speaker.badge,
      color: speaker.color,
      text: safeLine(text),
      kind: 'chat'
    })
  }
  return messages
}
