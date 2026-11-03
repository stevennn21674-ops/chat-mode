import { isKidSafe } from './filter'

export type ActivityState = 'idle' | 'exploring' | 'action' | 'scare' | 'dark' | 'loading' | 'death' | 'victory'

export interface FrameSample {
  brightness: number
  motion: number
  redRatio: number
  darkRatio: number
  whiteRatio: number
}

export interface ActivityEvent {
  state: ActivityState
  game: string | null
  title: string | null
  detail: string
  at: number
  big: boolean
}

const GAME_TITLES: readonly [RegExp, string][] = [
  [/escape the backrooms/i, 'Escape the Backrooms'],
  [/backrooms/i, 'Escape the Backrooms'],
  [/roblox/i, 'Roblox'],
  [/minecraft/i, 'Minecraft'],
  [/fortnite/i, 'Fortnite'],
  [/friday night funkin|\bfnf\b|funkin/i, 'FNF']
]

const LINES: Record<ActivityState, string[]> = {
  idle: ['bro stopped moving', 'menu moment?', 'chat he is just sitting there', 'nothing is moving'],
  exploring: ["he's running!!", 'steady movement', 'where are we going', 'keep walking'],
  action: ['so much movement', 'lock in', 'chat look at the motion', 'it got fast'],
  scare: ['WAIT WHAT WAS THAT', 'that jump scare', 'NOPE', 'sudden cut'],
  dark: ['dark again lol', 'I cant see anything', 'why is it so dark', 'turn on a light'],
  loading: ['loading screen', 'hurry up load', 'the screen is waiting'],
  death: ['NOOO he died', 'that looked like a game over', 'rip the run', 'F'],
  victory: ['lets go a win screen', 'victory??', 'W', 'did we win']
}

export function sampleFrame(current: Uint8Array, previous: Uint8Array | null): FrameSample {
  const pixels = Math.floor(current.length / 4)
  if (!pixels) return { brightness: 0, motion: 0, redRatio: 0, darkRatio: 1, whiteRatio: 0 }
  const step = Math.max(1, Math.floor(pixels / 400))
  let bright = 0
  let red = 0
  let dark = 0
  let white = 0
  let motion = 0
  let compared = 0
  let count = 0
  for (let pixel = 0; pixel < pixels; pixel += step) {
    const index = pixel * 4
    const b = current[index] ?? 0
    const g = current[index + 1] ?? 0
    const r = current[index + 2] ?? 0
    const lum = 0.3 * r + 0.59 * g + 0.11 * b
    bright += lum
    if (lum < 28) dark += 1
    if (lum > 210) white += 1
    if (r > g + 25 && r > b + 20 && r > 80) red += 1
    count += 1
    if (previous && previous.length === current.length) {
      const plum = 0.3 * (previous[index + 2] ?? 0) + 0.59 * (previous[index + 1] ?? 0) + 0.11 * (previous[index] ?? 0)
      motion += Math.abs(lum - plum)
      compared += 1
    }
  }
  return {
    brightness: count ? bright / count : 0,
    motion: compared ? Math.min(1, motion / compared / 255) : 0,
    redRatio: count ? red / count : 0,
    darkRatio: count ? dark / count : 1,
    whiteRatio: count ? white / count : 0
  }
}

export function detectGame(title: string | null | undefined): string | null {
  if (!title) return null
  for (const [pattern, name] of GAME_TITLES) {
    if (pattern.test(title)) return name
  }
  return null
}

export function classifyActivity(input: {
  sample: FrameSample
  previous: FrameSample | null
  title: string | null
  stillFrames: number
  at?: number
}): ActivityEvent {
  const { sample, previous } = input
  const title = input.title?.replace(/\s+/g, ' ').trim().slice(0, 80) || null
  const game = detectGame(title)
  const flash = Boolean(previous && Math.abs(sample.brightness - previous.brightness) > 55)
  const sceneCut = sample.motion > 0.42
  const fadeOut = Boolean(previous && previous.brightness > 70 && sample.brightness < 22 && previous.motion > 0.08)
  const redHit = sample.redRatio > 0.33 && (sceneCut || flash)
  const titleVictory = Boolean(title && /victory|you win|winner|first place/i.test(title))
  const titleDeath = Boolean(title && /game over|you died|wasted/i.test(title))
  const titleLoading = Boolean(title && /loading|please wait|connecting/i.test(title))
  let state: ActivityState = 'idle'
  if (titleVictory) state = 'victory'
  else if (titleDeath || fadeOut || redHit) state = 'death'
  else if (sceneCut || flash) state = 'scare'
  else if (sample.brightness < 40 && sample.darkRatio > 0.55) state = 'dark'
  else if (titleLoading || (sample.motion < 0.03 && sample.whiteRatio > 0.72 && input.stillFrames >= 1)) state = 'loading'
  else if (sample.motion < 0.035 && input.stillFrames >= 2 && sample.brightness > 36) state = 'idle'
  else if (sample.motion >= 0.2) state = 'action'
  else if (sample.motion >= 0.05) state = 'exploring'
  const detail = describe(state, game, title)
  return {
    state,
    game,
    title: title && isKidSafe(title) ? title : null,
    detail,
    at: input.at ?? 0,
    big: state === 'scare' || state === 'death' || state === 'victory'
  }
}

function describe(state: ActivityState, game: string | null, title: string | null): string {
  const gameNote = game ? `Window title matches ${game}.` : title && isKidSafe(title) ? `Window title: ${title}.` : ''
  const body =
    state === 'idle'
      ? 'The screen is still. This looks like a menu or a pause.'
      : state === 'exploring'
        ? 'Steady motion on the screen.'
        : state === 'action'
          ? 'High motion on the screen.'
          : state === 'scare'
            ? 'Sudden cut or flash on the screen.'
            : state === 'dark'
              ? 'The screen is dark.'
              : state === 'loading'
                ? 'The screen looks like a loading screen.'
                : state === 'death'
                  ? 'Sudden red, black, or fade. This can be a game over.'
                  : 'The window title looks like a victory.'
  return `${gameNote} ${body}`.trim()
}

export function activityLines(state: ActivityState, game: string | null): string[] {
  const lines = [...LINES[state]]
  if (game) lines.push(`this is ${game}`, `what game is this? ${game}`)
  return lines
}

export function shouldSample(input: {
  enabled: boolean
  chatEnabled: boolean
  onBattery: boolean
  pauseOnBattery: boolean
  idle: boolean
  cpuHigh?: boolean
}): boolean {
  if (!input.enabled || !input.chatEnabled) return false
  if (input.idle) return false
  if (input.onBattery && input.pauseOnBattery) return false
  if (input.cpuHigh) return false
  return true
}

export function watchIntervalMs(stillFrames: number, base = 2500, still = 15_000): number {
  if (stillFrames >= 8) return Math.max(still, 15_000)
  if (stillFrames >= 3) return Math.max(8000, Math.round((base + still) / 2))
  return base
}

export function allowAutoVision(input: {
  aiMode: boolean
  autoVision: boolean
  offline: boolean
  big: boolean
  usedThisHour: number
  cap: number
  serviceCalls?: number
  serviceCap?: number
  reserveForVoice?: boolean
}): boolean {
  if (!input.aiMode || !input.autoVision || input.offline || !input.big) return false
  if (input.usedThisHour >= Math.max(1, input.cap)) return false
  if (input.reserveForVoice && typeof input.serviceCap === 'number' && typeof input.serviceCalls === 'number') {
    if (input.serviceCalls >= Math.max(0, input.serviceCap - 1)) return false
  }
  return true
}
