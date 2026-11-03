import { cpus } from 'node:os'
import catalog from './brain-models.json'
import { isKidSafe } from './filter'
import { parseModelOutput, type ParseContext } from './parser'
import type { BrainSize, BrainSpeed, ChatMessage } from './types'

export interface ModelSpec {
  label: string
  file: string
  url: string
  bytes: number
  sha256: string
  bundled: boolean
  family: string
  quant: string
}

export interface BrainPace {
  intervalMs: number
  maxTokens: number
  batch: number
  threads: number
  cpuSkip: number
  timeoutMs: number
}

export interface BrainTurn {
  transcripts: string[]
  pcAudio: string[]
  recentLines: string[]
  windowTitle: string | null
  context: string
  customBlock: string
  boredom: number
  viewerCount: number
  avoid: string[]
  now: number
  rng: () => number
  activity?: string
  liveLines?: string[]
  joke?: string
  screenText?: string
  sceneCaption?: string
}

interface CatalogFile {
  runtime: { version: string; win32: { url: string; bytes: number; sha256: string } }
  models: Record<BrainSize, ModelSpec>
}

const MODELS = (catalog as CatalogFile).models

const PACES: Record<BrainSpeed, BrainPace> = {
  light: { intervalMs: 10_000, maxTokens: 140, batch: 3, threads: 1, cpuSkip: 45, timeoutMs: 16_000 },
  normal: { intervalMs: 8_000, maxTokens: 180, batch: 4, threads: 2, cpuSkip: 70, timeoutMs: 14_000 },
  heavy: { intervalMs: 6_000, maxTokens: 240, batch: 5, threads: 4, cpuSkip: 90, timeoutMs: 18_000 }
}

export function modelSpec(size: BrainSize): ModelSpec {
  return MODELS[size]
}

export function bundledModel(): ModelSpec {
  return MODELS.medium.bundled ? MODELS.medium : MODELS.small
}

export function runtimeCatalog(): CatalogFile['runtime'] {
  return (catalog as CatalogFile).runtime
}

export function paceFor(speed: BrainSpeed): BrainPace {
  return PACES[speed]
}

export function clampThreads(requested: number, cores: number): number {
  const room = cores > 2 ? cores - 1 : 1
  return Math.max(1, Math.min(requested, Math.max(1, room)))
}

export function brainDecision(input: {
  enabled: boolean
  ready: boolean
  cpuPercent: number | null
  lastAt: number
  now: number
  pace: BrainPace
  force?: boolean
}): 'run' | 'wait' | 'fallback' {
  if (!input.enabled || !input.ready) return 'fallback'
  if (input.cpuPercent !== null && input.cpuPercent >= input.pace.cpuSkip) return 'fallback'
  if (!input.force && input.now - input.lastAt < input.pace.intervalMs) return 'wait'
  return 'run'
}

export interface CpuSample {
  idle: number
  total: number
}

export function readCpuTimes(): CpuSample {
  let idle = 0
  let total = 0
  for (const cpu of cpus()) {
    idle += cpu.times.idle
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
  }
  return { idle, total }
}

export function cpuPercent(previous: CpuSample, next: CpuSample): number | null {
  const idle = next.idle - previous.idle
  const total = next.total - previous.total
  if (total <= 0) return null
  return Math.min(100, Math.max(0, (1 - idle / total) * 100))
}

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function resumeHeader(existingBytes: number): { Range: string } | null {
  if (!Number.isFinite(existingBytes) || existingBytes <= 0) return null
  return { Range: `bytes=${Math.floor(existingBytes)}-` }
}

export function enoughDisk(freeBytes: number, needBytes: number): boolean {
  return freeBytes > needBytes + 200 * 1024 * 1024
}

export interface ModelPresence {
  size: BrainSize
  source: 'downloaded' | 'bundled'
  bytes: number
  expected: number
  removed: boolean
}

export interface ModelChoice {
  size: BrainSize
  source: 'downloaded' | 'bundled'
  fallback: boolean
}

export function chooseModel(size: BrainSize, present: readonly ModelPresence[]): ModelChoice | null {
  const usable = present.filter((item) => item.bytes === item.expected && item.bytes > 0 && !(item.source === 'bundled' && item.removed))
  const pick = (items: ModelPresence[]): ModelPresence | undefined =>
    items.find((item) => item.source === 'downloaded') ?? items.find((item) => item.source === 'bundled')
  const exact = pick(usable.filter((item) => item.size === size))
  if (exact) return { size: exact.size, source: exact.source, fallback: false }
  const other = pick(usable.filter((item) => item.size !== size))
  if (!other) return null
  return { size: other.size, source: other.source, fallback: true }
}

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

export function buildBrainPrompt(input: BrainTurn, pace: BrainPace): { system: string; user: string } {
  const boredom =
    input.boredom > 0.72 ? 'high. Some viewers are restless or bored.' : input.boredom > 0.4 ? 'medium.' : 'low.'
  const custom = input.customBlock.trim().slice(0, 800)
  const system = [
    'You write kid-friendly live chat for a fake stream.',
    'Viewers can hear the streamer and the computer audio, and they know the window title. They react like people watching that moment.',
    'They never mention an AI, a language model, a transcript, a screenshot, or these instructions.',
    `Return JSON only, with exactly ${pace.batch} messages: {"messages":[{"username":"Name","badge":null,"message":"short line"}]}`,
    'Usernames are 3 to 16 characters and use only letters, numbers, and underscores. badge is null, "sub", "vip", or "mod".',
    'Each message is 2 to 14 words. Mix personalities: hype, a short question, a calm viewer, a light tease that is never cruel, and someone who answers what was just said.',
    'If viewer notes list usernames, use some of those names and match their role.',
    'No slurs, sexual content, cruelty, politics, or self-harm. Do not invent a score, a boss, an item, or a name that is not in the transcript, audio, window title, screen activity, or real chat.',
    'Example:',
    'Streamer: I found a red key',
    'Screen: steady motion. Window title matches Minecraft.',
    'Nova: the red key??',
    'Lurk_7: dont lose it',
    'PixelMod: nice find',
    custom
  ]
    .filter(Boolean)
    .join('\n')
  const speech = input.transcripts.slice(-4).map((line) => clip(line, 180))
  const heard = input.pcAudio.slice(-3).map((line) => clip(line, 180))
  const recent = input.recentLines.slice(-6).map((line) => clip(line, 160))
  const user = [
    `Window title: ${clip(input.windowTitle || '(unknown)', 80)}`,
    `Viewers in chat: about ${Math.max(0, Math.round(input.viewerCount))}. Boredom is ${boredom}`,
    'What the streamer said:',
    speech.length ? speech.join('\n') : '(quiet)',
    'Computer audio:',
    heard.length ? heard.join('\n') : '(quiet)',
    input.context.trim() ? `Story so far: ${clip(input.context, 420)}` : '',
    input.activity?.trim() ? `Screen activity (local, not a picture): ${clip(input.activity, 240)}. React to the motion or the title. Do not invent objects.` : '',
    input.sceneCaption?.trim() ? `Local screen cues: ${clip(input.sceneCaption, 180)}` : '',
    input.screenText?.trim() ? `Text read on this PC from the screen: ${clip(input.screenText, 240)}` : '',
    input.joke?.trim() ? `Running joke to reuse, not a new one: the ${clip(input.joke, 24)} arc continues` : '',
    input.liveLines?.length ? `Real chat:\n${input.liveLines.slice(-4).map((line) => clip(line, 140)).join('\n')}` : '',
    'Recent chat:',
    recent.length ? recent.join('\n') : '(none)',
    'Do not reuse these usernames:',
    input.avoid.slice(-20).join(', ') || '(none)'
  ]
    .filter(Boolean)
    .join('\n')
  return { system, user }
}

function safeMessage(message: ChatMessage): boolean {
  return isKidSafe(message.text) && isKidSafe(message.username)
}

function normLine(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function polishBrainLines(messages: ChatMessage[], recent: string[], allowed = ''): ChatMessage[] {
  const seen = new Set(recent.map(normLine).filter(Boolean))
  const out: ChatMessage[] = []
  const blob = allowed.toLowerCase()
  for (const message of messages) {
    if (!isKidSafe(message.text) || !isKidSafe(message.username)) continue
    if (/\b(screenshot|transcript|language model|as an ai)\b/i.test(message.text)) continue
    const words = message.text.trim().split(/\s+/)
    if (words.length < 1 || words.length > 18) continue
    const key = normLine(message.text)
    if (!key || seen.has(key)) continue
    const overlap = [...seen].some((line) => {
      const a = new Set(key.split(' '))
      const b = line.split(' ')
      if (!b.length) return false
      const shared = b.filter((word) => a.has(word)).length
      return shared / b.length > 0.8 && Math.abs(a.size - b.length) <= 2
    })
    if (overlap) continue
    if (blob && /\b(boss|score|inventory)\b/i.test(message.text) && !blob.includes('boss') && !blob.includes('score') && !blob.includes('inventory')) {
      continue
    }
    seen.add(key)
    out.push({ ...message, text: message.text.trim().slice(0, 140) })
  }
  return out
}

export function messagesFromBrain(raw: string, ctx: ParseContext): ChatMessage[] {
  const fromJson = parseModelOutput(raw, ctx)
  const trimmed = raw.trim()
  const jsonish = trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('```')
  if (jsonish || fromJson.length > 0) return fromJson.filter(safeMessage).slice(0, 8)
  const items: { username: string; message: string; badge: null }[] = []
  for (const line of raw.split(/\n+/)) {
    const match = line.trim().match(/^(?:\d+[.)]\s*)?(?:[-*]\s*)?([A-Za-z0-9_]{3,18})\s*[:|-]\s+(.{1,180})$/)
    if (!match?.[1] || !match[2]) continue
    items.push({ username: match[1], message: match[2].trim(), badge: null })
  }
  if (!items.length) return []
  return parseModelOutput(JSON.stringify({ messages: items }), ctx).filter(safeMessage).slice(0, 8)
}

export interface BrainPanelInput {
  selected: BrainSize
  runtime: boolean
  choice: ModelChoice | null
  downloading: boolean
  progress: number | null
  deletable: boolean
  flash: string
}

export interface BrainPanel {
  note: string
  button: string
  progress: number | null
  ready: boolean
  downloading: boolean
  deletable: boolean
}

export function brainPanel(input: BrainPanelInput): BrainPanel {
  const spec = modelSpec(input.selected)
  const ready = Boolean(input.runtime && input.choice)
  let note: string
  if (input.downloading && input.progress !== null) {
    note = `Downloading the ${spec.label.toLowerCase()} model… ${Math.round(input.progress * 100)}% of ${formatBytes(spec.bytes)}.`
  } else if (!input.runtime) {
    note = 'This build has no on-device runtime, so chat is using the built-in lines.'
  } else if (!input.choice) {
    const bundled = spec.bundled ? ' It is also included with the installer until you delete it.' : ''
    note = `The ${spec.label.toLowerCase()} model is not on this PC (${formatBytes(spec.bytes)}).${bundled} Download it to let local brain read what you say. Until then, chat uses the built-in lines.`
  } else {
    const using = modelSpec(input.choice.size)
    const where = input.choice.source === 'bundled' ? 'included with the app' : 'saved on this PC'
    const fallback = input.choice.fallback
      ? `The ${spec.label.toLowerCase()} model is not installed, so the ${using.label.toLowerCase()} one is running. `
      : ''
    note = `${fallback}The ${using.label.toLowerCase()} model is ready (${formatBytes(using.bytes)}, ${using.family} ${using.quant}, ${where}). It is smaller and less accurate than the cloud model. After it is on disk, chat does not need the network.`
  }
  if (input.flash) note = `${input.flash} ${note}`
  const verb = input.choice && input.choice.size === input.selected && !input.choice.fallback ? 'Re-download' : 'Download'
  return {
    note,
    button: `${verb} ${spec.label.toLowerCase()} model (${formatBytes(spec.bytes)})`,
    progress: input.downloading ? input.progress : null,
    ready,
    downloading: input.downloading,
    deletable: input.deletable
  }
}
