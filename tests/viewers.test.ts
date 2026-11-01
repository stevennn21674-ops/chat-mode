import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  boredomTarget,
  chatSlots,
  createCrowd,
  formatViewerCount,
  markTalking,
  noteChatLine,
  noteScreen,
  tickCrowd,
  type Crowd
} from '../src/shared/crowd'
import {
  buildModeration,
  parseModCommand,
  resolveModTarget,
  spamBump,
  withoutChatter,
  type Chatter
} from '../src/shared/moderation'
import { dominantColorNames, screenChange } from '../src/shared/screen-cues'
import { findTopLevelLetUseBeforeInit, startupStateReady } from '../src/shared/startup'

function neutral(crowd: Crowd, now: number): void {
  crowd.lastSpeechAt = now - 20_000
  crowd.lastScreenAt = now
  crowd.lastScreenChange = 0.2
  crowd.boredom = 0.3
  crowd.repetitive = 0
}

describe('viewer count and boredom', () => {
  it('starts at a plausible count and drifts both ways', () => {
    const crowd = createCrowd(() => 0.2, 0)
    expect(crowd.count).toBeGreaterThanOrEqual(42)
    expect(crowd.count).toBeLessThanOrEqual(192)
    expect(crowd.viewers.some((viewer) => viewer.badge === 'mod')).toBe(true)
    expect(formatViewerCount(1284)).toBe('1,284')

    const down = createCrowd(() => 0.2, 0)
    const downStart = down.count
    neutral(down, 30_000)
    tickCrowd(down, { now: 30_000, idle: false, micLive: false, rng: () => 0 })
    expect(down.count).toBeLessThan(downStart)

    const up = createCrowd(() => 0.2, 0)
    const upStart = up.count
    neutral(up, 30_000)
    tickCrowd(up, { now: 30_000, idle: false, micLive: false, rng: () => 0.99 })
    expect(up.count).toBeGreaterThan(upStart)
  })

  it('gets quiet and loses viewers when nothing happens, then recovers', () => {
    const crowd = createCrowd(() => 0.5, 0)
    crowd.lastSpeechAt = 0
    crowd.lastScreenAt = 0
    crowd.lastScreenChange = 0
    const start = crowd.count
    const names = new Set(crowd.viewers.map((viewer) => viewer.name))
    let left = false
    for (let i = 0; i < 4; i++) {
      const events = tickCrowd(crowd, { now: 90_000 + i * 4000, idle: true, micLive: false, rng: () => 0 })
      if (events.some((event) => event.type === 'leave' && /bored|gn|brb|zzz|dip/i.test(event.text ?? ''))) left = true
    }
    expect(left).toBe(true)
    expect(crowd.count).toBeLessThan(start)
    expect(chatSlots(crowd)).toBe(0)
    expect(crowd.viewers.some((viewer) => !names.has(viewer.name))).toBe(false)

    const low = crowd.count
    const before = new Set(crowd.viewers.map((viewer) => viewer.name))
    markTalking(crowd, 200_000)
    noteScreen(crowd, 0.9, 200_000)
    tickCrowd(crowd, { now: 200_000, idle: false, micLive: true, rng: () => 0 })
    expect(crowd.count).toBeGreaterThan(low)
    expect(crowd.viewers.some((viewer) => !before.has(viewer.name))).toBe(true)
    expect(crowd.boredom).toBeLessThan(0.82)
  })

  it('treats a repetitive chat as more boring', () => {
    const crowd = createCrowd(() => 0.4, 0)
    crowd.lastSpeechAt = 0
    crowd.lastScreenAt = 20_000
    crowd.lastScreenChange = 0.2
    const input = { now: 20_000, idle: false, micLive: false }
    const calm = boredomTarget(crowd, input)
    for (let i = 0; i < 8; i++) noteChatLine(crowd, 'same line again')
    expect(crowd.repetitive).toBeGreaterThan(0.5)
    expect(boredomTarget(crowd, input)).toBeGreaterThan(calm)
  })
})

describe('moderation without a service call', () => {
  const chatters: Chatter[] = [
    { name: 'pixel_fox', spam: 0, recentIndex: 0 },
    { name: 'NovaByte', spam: 1, recentIndex: 1 },
    { name: 'loud_lurker', spam: 9, recentIndex: 2, mod: false },
    { name: 'GreenSword', spam: 4, recentIndex: 3, mod: true }
  ]

  it('parses spoken ban and timeout phrases', () => {
    expect(parseModCommand('ban pixel fox')).toMatchObject({ action: 'ban', target: 'named', spokenName: 'pixel fox' })
    expect(parseModCommand('timeout pixel fox')).toMatchObject({ action: 'timeout', target: 'named' })
    expect(parseModCommand('mods ban him')).toMatchObject({ target: 'recent' })
    expect(parseModCommand('mods ban that guy')).toMatchObject({ target: 'recent' })
    expect(parseModCommand('ban the spammer')).toMatchObject({ target: 'spammer' })
    expect(parseModCommand('please mods time out Nova')).toMatchObject({ action: 'timeout', spokenName: 'nova' })
    expect(parseModCommand('bananas are cool')).toBeNull()
  })

  it('fuzzy-matches a name and falls back to the latest or spammiest viewer', () => {
    expect(resolveModTarget(parseModCommand('ban pixle fox')!, chatters)).toBe('pixel_fox')
    expect(resolveModTarget(parseModCommand('timeout novabyte')!, chatters)).toBe('NovaByte')
    expect(resolveModTarget(parseModCommand('mods ban him')!, chatters)).toBe('loud_lurker')
    expect(resolveModTarget(parseModCommand('ban the spammer')!, chatters)).toBe('loud_lurker')
  })

  it('builds a mod reply, a ban line, and drops that viewer from the log', () => {
    const messages = buildModeration({
      target: 'pixel_fox',
      modName: 'GreenSword',
      rng: () => 0,
      now: 50
    })
    expect(messages[0]).toMatchObject({ username: 'GreenSword', badge: 'mod', kind: 'chat' })
    expect(messages[1]).toMatchObject({
      kind: 'system',
      text: 'pixel_fox has been banned',
      purgeUser: 'pixel_fox'
    })
    expect(withoutChatter(['pixel_fox: hi', 'NovaByte: yo', 'pixel_fox: again'], 'pixel_fox')).toEqual(['NovaByte: yo'])
    expect(spamBump('lol', 'lol')).toBeGreaterThan(0)
    expect(spamBump(undefined, 'HELLO THERE')).toBeGreaterThan(0)
    expect(buildModeration({ target: null, modName: 'GreenSword', rng: () => 0, now: 1 })).toHaveLength(1)
  })
})

describe('screen cues', () => {
  it('measures change and names a dominant color', () => {
    expect(screenChange('ffff', 'ffff')).toBe(0)
    expect(screenChange('0000', 'ffff')).toBe(1)
    expect(screenChange(null, 'abcd')).toBeGreaterThan(0.5)
    const red = new Uint8Array([0, 0, 220, 255, 0, 0, 210, 255])
    expect(dominantColorNames(red)).toContain('red')
  })
})

describe('startup order', () => {
  it('initializes startup state before tray or main can read it', () => {
    expect(startupStateReady()).toBe(true)
    const root = join(import.meta.dirname, '..')
    for (const file of ['src/main/tray.ts', 'src/main/index.ts', 'src/shared/startup.ts']) {
      expect(findTopLevelLetUseBeforeInit(readFileSync(join(root, file), 'utf8')), file).toEqual([])
    }
    const early = 'render()\nlet aiModeDefault = false\nfunction render() {\n  return aiModeDefault\n}\n'
    expect(findTopLevelLetUseBeforeInit(early)).toEqual(['aiModeDefault'])
  })
})
