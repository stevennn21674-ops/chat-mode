import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatController } from '../src/main/chat-controller'
import { asFloat32 } from '../src/shared/audio'
import { cleanOcrText, groundedLines, ocrCrop, ocrFacts, OCR_LANG_BYTES } from '../src/shared/ocr-text'
import { sceneCue } from '../src/shared/scene-cues'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import type { ChatMessage } from '../src/shared/types'
import { buildVoiceReactions, scheduleVoiceReactions, silenceLines, stickForScroll, voiceReplyCount } from '../src/shared/voice-react'
import type { AppSettings } from '../src/shared/types'

const roster = [
  { name: 'ModMaven', badge: 'mod' as const, color: '#7dffa8' },
  { name: 'LurkBot', badge: null, color: '#8eb6ff' },
  { name: 'HyperCat', badge: null, color: '#ffd36e' },
  { name: 'CalmIvy', badge: 'vip' as const, color: '#d7b3ff' }
]

const custom = {
  id: 'px',
  username: 'PixelMod',
  role: 'mod' as const,
  color: '#9dffc2',
  active: true,
  description: 'keeps it kind',
  talkativeness: 80,
  positivity: 80,
  hype: 30,
  trolling: 5,
  presence: 90,
  emoji: 0,
  caps: 0,
  slang: 0,
  phrases: ['nice find'],
  topics: ['keys']
}

function settings(patch: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, localBrain: false, aiMode: false, readScreenText: false, ...patch }
}

describe('voice reactions', () => {
  it('answers a short line with several viewers over about ten seconds', () => {
    const messages = buildVoiceReactions({
      transcript: 'hello there friend',
      earlier: ['the red door'],
      rng: () => 0,
      roster,
      custom: [custom],
      now: 1_000
    })
    expect(messages.length).toBeGreaterThanOrEqual(3)
    expect(messages.length).toBeLessThanOrEqual(8)
    expect(new Set(messages.map((message) => message.username)).size).toBe(messages.length)
    expect(messages.some((message) => message.badge === 'mod')).toBe(true)
    expect(messages.some((message) => message.username === 'PixelMod')).toBe(true)
    expect(messages.some((message) => /hey|hello|friend/i.test(message.text))).toBe(true)
    expect(messages.some((message) => message.text.includes('?'))).toBe(true)
    expect(messages.some((message) => message.text.toLowerCase().includes('earlier you said'))).toBe(true)
    expect(messages.some((message, index) => index > 0 && messages.slice(0, index).some((prev) => message.text.includes(prev.username)))).toBe(true)
    const times = scheduleVoiceReactions(messages, 5_000)
    expect(times[0]?.at).toBeLessThan(7_000)
    expect(times[times.length - 1]?.at).toBeGreaterThan(11_000)
    expect(voiceReplyCount('hi', true)).toBeGreaterThanOrEqual(3)
    expect(voiceReplyCount('hi', true)).toBeLessThan(voiceReplyCount('hi', false))
  })

  it('uses the screen text and different parts of a long line', () => {
    const scene = {
      title: 'Minecraft',
      game: 'Minecraft',
      colors: ['red'],
      kind: 'gameplay' as const,
      motion: 'moving' as const,
      ocr: 'Level 0 HP 12 score 40',
      textLike: true,
      warm: false
    }
    const asked = buildVoiceReactions({
      transcript: 'what is this place',
      scene,
      rng: () => 0,
      roster,
      now: 2_000
    })
    expect(asked.some((message) => /level 0|minecraft|health|red/i.test(message.text))).toBe(true)
    const long = `${Array.from({ length: 10 }, () => 'dragon').join(' ')} ${Array.from({ length: 10 }, () => 'treasure').join(' ')} ${Array.from({ length: 10 }, () => 'bridge').join(' ')}`
    expect(long.split(/\s+/).length).toBeGreaterThanOrEqual(28)
    const parts = buildVoiceReactions({ transcript: long, rng: () => 0, roster, now: 3_000 })
    expect(parts.length).toBeGreaterThanOrEqual(6)
    const blob = parts.map((message) => message.text.toLowerCase()).join(' ')
    expect(blob).toContain('dragon')
    expect(blob).toContain('treasure')
    expect(silenceLines('Minecraft').some((line) => line.includes('Minecraft'))).toBe(true)
    expect(stickForScroll(false, 0)).toBe(false)
    expect(stickForScroll(true, 4)).toBe(true)
    expect(stickForScroll(true, 40)).toBe(false)
  })
})

describe('screen text and cues', () => {
  it('keeps readable labels and a small english download', () => {
    expect(OCR_LANG_BYTES).toBeLessThan(3_000_000)
    expect(cleanOcrText('Level 0\nHP 12\n@@@')).toContain('Level 0')
    expect(ocrFacts('Level 0 HP 12 score 400').level).toBe('Level 0')
    expect(ocrFacts('HP 12').health).toBe(12)
    expect(groundedLines({ ocr: 'HP 12', colors: ['red'], game: 'Minecraft', kind: 'gameplay' })).toContain('why is your health so low')
    expect(ocrCrop(100, 80).width).toBeLessThan(100)
    const width = 48
    const height = 16
    const bgra = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4
        const on = Math.floor(x / 4) % 2 === 0
        bgra[index] = on ? 0 : 255
        bgra[index + 1] = on ? 0 : 255
        bgra[index + 2] = on ? 0 : 255
      }
    }
    const cue = sceneCue(bgra, width, height)
    expect(cue.textLike).toBe(true)
    expect(asFloat32(new Uint8Array(3), 'f32le')).toBeNull()
  })
})

describe('transcript routing', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function controller(patch: Partial<AppSettings> = {}, extra: {
    usage?: () => { timestamps: number[] }
    complete?: (params: { userText: string; imageBase64: string | null }) => Promise<{ ok: false; reason: 'unavailable' }>
    capture?: () => Promise<{ jpegBase64: string; hash: string; colors: string[]; title: string; scene: { brightness: 'bright'; textLike: false; warm: false; uiLikely: false } }>
  } = {}) {
    const sent: ChatMessage[] = []
    const chat = new ChatController({
      getSettings: () => settings(patch),
      updateSettings: () => undefined,
      sendMessage: (message) => sent.push(message),
      config: () => ({ apiKey: 'key', model: 'm', endpoint: 'https://example.test/v1/chat/completions' }),
      capture: extra.capture ?? (async () => null),
      pcAudio: async () => ({ text: '', loud: false }),
      usage: extra.usage ?? (() => ({ timestamps: [] })),
      setUsage: () => undefined,
      power: () => ({ idle: false, onBattery: false }),
      log: () => undefined,
      offline: () => false,
      complete: extra.complete
    })
    return { chat, sent }
  }

  it('still replies when the hourly cap and a busy brain would skip a normal turn', async () => {
    vi.useFakeTimers()
    const { chat, sent } = controller({
      aiMode: true,
      maxCallsPerHour: 4
    }, {
      usage: () => ({ timestamps: Array.from({ length: 8 }, () => Date.now()) })
    })
    chat.start(() => undefined)
    await chat.noteSpeech('hello there friend')
    await vi.advanceTimersByTimeAsync(2000)
    expect(sent.length).toBeGreaterThanOrEqual(1)
    expect(sent.some((message) => /hey|hello|friend/i.test(message.text))).toBe(true)
    chat.stop()
  })

  it('sends the transcript and one screenshot in a single call when a slot is free', async () => {
    const seen: { userText: string; imageBase64: string | null }[] = []
    const { chat } = controller({
      aiMode: true,
      lookAtScreenWhenTalking: true,
      readScreenText: false
    }, {
      capture: async () => ({
        jpegBase64: 'frame-jpeg',
        hash: 'abc',
        colors: ['red'],
        title: 'Minecraft',
        scene: { brightness: 'bright', textLike: false, warm: false, uiLikely: false }
      }),
      complete: async (params) => {
        seen.push(params)
        return { ok: false, reason: 'unavailable' }
      }
    })
    chat.start(() => undefined)
    await chat.prepareVoiceScreen()
    await chat.noteSpeech('where is the red key')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.imageBase64).toBe('frame-jpeg')
    expect(seen[0]?.userText).toContain('where is the red key')
    chat.stop()
  })
})
