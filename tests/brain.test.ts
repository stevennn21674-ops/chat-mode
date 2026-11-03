import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  brainDecision,
  brainPanel,
  buildBrainPrompt,
  chooseModel,
  clampThreads,
  cpuPercent,
  enoughDisk,
  formatBytes,
  messagesFromBrain,
  modelSpec,
  paceFor,
  resumeHeader,
  runtimeCatalog
} from '../src/shared/brain'
import { applyPatch, DEFAULT_SETTINGS } from '../src/shared/settings'

const pace = paceFor('normal')

describe('local brain catalog', () => {
  it('offers the Q4 and Q8 downloads and does not bundle either model', () => {
    const medium = modelSpec('medium')
    const small = modelSpec('small')
    expect(medium.bundled).toBe(false)
    expect(medium.family).toBe('Qwen2.5-0.5B-Instruct')
    expect(medium.quant).toBe('Q8_0')
    expect(medium.bytes).toBeGreaterThan(0.4 * 1e9)
    expect(medium.bytes).toBeLessThan(0.8 * 1e9)
    expect(small.bundled).toBe(false)
    expect(modelSpec('smart').bundled).toBe(false)
    expect(small.bytes).toBeLessThan(medium.bytes)
    expect(small.bytes).toBeGreaterThan(0.4 * 1e9)
    expect(formatBytes(medium.bytes)).toBe('644 MB')
    expect(formatBytes(small.bytes)).toBe('469 MB')
    expect(runtimeCatalog().version).toBe('b12032')
    expect(runtimeCatalog().win32.sha256).toHaveLength(64)
  })

  it('saves the speed and size settings', () => {
    expect(DEFAULT_SETTINGS.localBrain).toBe(true)
    expect(DEFAULT_SETTINGS.brainSpeed).toBe('normal')
    expect(DEFAULT_SETTINGS.brainSize).toBe('medium')
    const next = applyPatch(DEFAULT_SETTINGS, { localBrain: false, brainSpeed: 'light', brainSize: 'small', brainSpeedExtra: 'turbo' })
    expect(next.localBrain).toBe(false)
    expect(next.brainSpeed).toBe('light')
    expect(next.brainSize).toBe('small')
    expect(applyPatch(DEFAULT_SETTINGS, { brainSpeed: 'turbo', brainSize: 'huge' })).toMatchObject({
      brainSpeed: 'normal',
      brainSize: 'medium'
    })
  })
})

describe('local brain scheduling', () => {
  it('waits, skips a busy CPU, and falls back when the model is missing', () => {
    expect(brainDecision({ enabled: true, ready: true, cpuPercent: 10, lastAt: 0, now: 20_000, pace })).toBe('run')
    expect(brainDecision({ enabled: true, ready: true, cpuPercent: 10, lastAt: 20_000, now: 25_000, pace })).toBe('wait')
    expect(brainDecision({ enabled: true, ready: true, cpuPercent: 10, lastAt: 20_000, now: 25_000, pace, force: true })).toBe('run')
    expect(brainDecision({ enabled: true, ready: true, cpuPercent: 80, lastAt: 0, now: 20_000, pace })).toBe('fallback')
    expect(brainDecision({ enabled: true, ready: true, cpuPercent: 80, lastAt: 0, now: 20_000, pace: paceFor('heavy') })).toBe('run')
    expect(brainDecision({ enabled: false, ready: true, cpuPercent: null, lastAt: 0, now: 20_000, pace })).toBe('fallback')
    expect(brainDecision({ enabled: true, ready: false, cpuPercent: null, lastAt: 0, now: 20_000, pace })).toBe('fallback')
    expect(paceFor('light').intervalMs).toBe(10_000)
    expect(paceFor('heavy').intervalMs).toBe(6_000)
    expect(clampThreads(4, 2)).toBe(1)
    expect(clampThreads(4, 8)).toBe(4)
    expect(cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 300 })).toBe(50)
    expect(cpuPercent({ idle: 1, total: 1 }, { idle: 1, total: 1 })).toBeNull()
  })

  it('prefers a download and ignores a deleted bundled copy', () => {
    const medium = modelSpec('medium')
    const small = modelSpec('small')
    expect(chooseModel('medium', [{ size: 'medium', source: 'bundled', bytes: medium.bytes, expected: medium.bytes, removed: true }])).toBeNull()
    expect(
      chooseModel('medium', [
        { size: 'medium', source: 'bundled', bytes: medium.bytes, expected: medium.bytes, removed: true },
        { size: 'small', source: 'downloaded', bytes: small.bytes, expected: small.bytes, removed: false }
      ])
    ).toEqual({ size: 'small', source: 'downloaded', fallback: true })
    expect(
      chooseModel('medium', [
        { size: 'medium', source: 'bundled', bytes: medium.bytes, expected: medium.bytes, removed: false },
        { size: 'medium', source: 'downloaded', bytes: medium.bytes, expected: medium.bytes, removed: false }
      ])
    ).toEqual({ size: 'medium', source: 'downloaded', fallback: false })
    expect(resumeHeader(0)).toBeNull()
    expect(resumeHeader(120)).toEqual({ Range: 'bytes=120-' })
    expect(enoughDisk(medium.bytes, medium.bytes)).toBe(false)
    expect(enoughDisk(medium.bytes + 300 * 1024 * 1024, medium.bytes)).toBe(true)
  })
})

describe('local brain text', () => {
  const turn = {
    transcripts: ['we found the red key'],
    pcAudio: ['the boss is waking up'],
    recentLines: ['Nova: hi'],
    windowTitle: 'Escape the Backrooms',
    context: 'Heard: the red door | People: backrooms x2',
    customBlock: '- PixelMod (mod) | keeps it kind',
    boredom: 0.8,
    viewerCount: 12,
    avoid: ['Nova'],
    now: 1,
    rng: () => 0
  }

  it('passes the same kind of context the cloud path uses', () => {
    const prompt = buildBrainPrompt(turn, pace)
    expect(prompt.user).toContain('we found the red key')
    expect(prompt.user).toContain('the boss is waking up')
    expect(prompt.user).toContain('Escape the Backrooms')
    expect(prompt.user).toContain('Heard: the red door')
    expect(prompt.user).toContain('bored')
    expect(prompt.system).toContain('PixelMod')
    expect(prompt.system).toContain('exactly 4')
  })

  it('drops lines the kid-friendly filter rejects', () => {
    const raw = JSON.stringify({
      messages: [
        { username: 'NiceKid', message: 'the red key lets go' },
        { username: 'MeanKid', message: 'what the fuck' }
      ]
    })
    expect(messagesFromBrain(raw, { now: 1, rng: () => 0, avoid: new Set() }).map((message) => message.text)).toEqual(['the red key lets go'])
    const loose = messagesFromBrain('NiceKid: the red key is back\nMeanKid: what the fuck', { now: 2, rng: () => 0, avoid: new Set() })
    expect(loose.map((message) => message.text)).toEqual(['the red key is back'])
  })

  it('describes a missing model and a ready bundled model', () => {
    const missing = brainPanel({
      selected: 'medium',
      runtime: true,
      choice: null,
      downloading: false,
      progress: null,
      deletable: false,
      flash: ''
    })
    expect(missing.ready).toBe(false)
    expect(missing.note).toContain('644 MB')
    expect(missing.button).toContain('Download')
    const ready = brainPanel({
      selected: 'medium',
      runtime: true,
      choice: { size: 'medium', source: 'bundled', fallback: false },
      downloading: false,
      progress: null,
      deletable: true,
      flash: ''
    })
    expect(ready.ready).toBe(true)
    expect(ready.note).toContain('less accurate')
    expect(ready.button).toContain('Re-download')
    expect(ready.note).toContain('does not need the network')
  })
})

describe('local brain wiring', () => {
  it('keeps AI mode on the cloud path and checks startup lets', () => {
    const root = join(import.meta.dirname, '..')
    const controller = readFileSync(join(root, 'src/main/chat-controller.ts'), 'utf8')
    expect(controller).toContain('settings.localBrain && !settings.aiMode')
    const workflow = readFileSync(join(root, '.github/workflows/build-windows.yml'), 'utf8')
    expect(workflow).toContain('1800MB')
    expect(workflow).not.toMatch(/^ {8}run:.*--publish never/m)
  })
})
