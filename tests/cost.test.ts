import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { callsInWindow, emptyUsage, nextWaitMs, recordCall, shouldCallModel, underCallCap } from '../src/shared/budget'
import { differenceHash, frameUnchanged, hammingHex } from '../src/shared/frame-diff'
import { coverInterval } from '../src/shared/schedule'
import { completionsUrlFromBase, DEFAULT_BASE_URL, resolveService } from '../src/shared/service-defaults'
import { usableTranscript } from '../src/shared/speech'
import type { ChatMessage } from '../src/shared/types'

function message(text: string): ChatMessage {
  return { id: text, username: 'viewer', badge: null, color: '#fff', text, kind: 'chat' }
}

describe('call budget', () => {
  it('defaults to a long eco interval and stretches it when idle or on battery', () => {
    expect(nextWaitMs({ captureIntervalSec: 25, ecoMode: true, idle: false, onBattery: false, backoffMs: 0 })).toBe(25000)
    expect(nextWaitMs({ captureIntervalSec: 10, ecoMode: true, idle: false, onBattery: false, backoffMs: 0 })).toBe(20000)
    expect(nextWaitMs({ captureIntervalSec: 25, ecoMode: true, idle: true, onBattery: false, backoffMs: 0 })).toBe(50000)
    expect(nextWaitMs({ captureIntervalSec: 25, ecoMode: true, idle: false, onBattery: true, backoffMs: 0 })).toBe(38000)
    expect(nextWaitMs({ captureIntervalSec: 100, ecoMode: true, idle: true, onBattery: true, backoffMs: 0 })).toBe(120000)
    expect(nextWaitMs({ captureIntervalSec: 15, ecoMode: false, idle: true, onBattery: true, backoffMs: 0 })).toBe(15000)
  })

  it('caps calls inside a rolling hour', () => {
    let usage = emptyUsage()
    expect(underCallCap(usage, 2, 1_000)).toBe(true)
    usage = recordCall(usage, 1_000)
    usage = recordCall(usage, 2_000)
    expect(callsInWindow(usage, 3_000)).toBe(2)
    expect(underCallCap(usage, 2, 3_000)).toBe(false)
    expect(callsInWindow(usage, 2_000 + 60 * 60 * 1000 + 1)).toBe(0)
    expect(shouldCallModel({ reason: 'interval', screenChanged: false, underCap: true, hasService: true })).toBe('unchanged')
    expect(shouldCallModel({ reason: 'voice', screenChanged: false, underCap: true, hasService: true })).toBe('ok')
    expect(shouldCallModel({ reason: 'voice', screenChanged: true, underCap: false, hasService: true })).toBe('capped')
    expect(shouldCallModel({ reason: 'interval', screenChanged: true, underCap: true, hasService: false })).toBe('offline')
  })
})

describe('frame diff', () => {
  it('treats a nearly identical frame as unchanged', () => {
    const width = 9
    const height = 8
    const pixels = new Uint8Array(width * height)
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 13) % 255
    const hash = differenceHash(pixels, width, height)
    expect(frameUnchanged(hash, hash)).toBe(true)
    const shifted = new Uint8Array(pixels)
    shifted[0] = shifted[0] === 0 ? 255 : 0
    const other = differenceHash(shifted, width, height)
    expect(hammingHex(hash, other)).toBeGreaterThan(0)
    expect(frameUnchanged(null, hash)).toBe(false)
  })
})

describe('service settings', () => {
  it('uses a typed key first and the build fallback otherwise', () => {
    expect(completionsUrlFromBase(DEFAULT_BASE_URL)).toBe('https://apihub.agnes-ai.com/v1/chat/completions')
    expect(completionsUrlFromBase('https://example.test/v1/')).toBe('https://example.test/v1/chat/completions')
    const user = resolveService({
      userKey: 'typed-key',
      model: 'custom-model',
      baseUrl: 'https://example.test/v1',
      fallbackKey: 'baked-key'
    })
    expect(user).toMatchObject({ apiKey: 'typed-key', model: 'custom-model', source: 'user' })
    const fallback = resolveService({ userKey: '', model: '', baseUrl: '', fallbackKey: 'baked-key' })
    expect(fallback.source).toBe('fallback')
    expect(fallback.apiKey).toBe('baked-key')
    expect(fallback.model.length).toBeGreaterThan(0)
  })

  it('ignores a blank voice clip', () => {
    expect(usableTranscript('  ')).toBe('')
    expect(usableTranscript('a')).toBe('')
    expect(usableTranscript('nice shot')).toBe('nice shot')
  })
})

describe('drip schedule', () => {
  it('spreads a short batch across most of the capture interval', () => {
    const scheduled = coverInterval(
      [
        { at: 1000, message: message('a') },
        { at: 1100, message: message('b') },
        { at: 1200, message: message('c') }
      ],
      1000,
      25000
    )
    expect(scheduled[0]?.at).toBeLessThan(scheduled[1]?.at ?? 0)
    expect(scheduled[2]?.at).toBeGreaterThan(20000)
  })
})

describe('windows workflow', () => {
  it('builds without a required secret and publishes both Windows executables', () => {
    const yaml = readFileSync(join(import.meta.dirname, '../.github/workflows/build-windows.yml'), 'utf8')
    const builder = readFileSync(join(import.meta.dirname, '../electron-builder.yml'), 'utf8')
    expect(yaml).not.toContain('REQUIRE_KEY')
    expect(yaml).toContain('actions/cache@v4')
    expect(yaml).toContain('upload-artifact@v4')
    expect(yaml).toContain('softprops/action-gh-release@v2')
    expect(yaml).toContain('node-version: 22.23.4')
    expect(builder).toContain('nsis')
    expect(builder).toContain('portable')
    expect(builder).toContain('signAndEditExecutable: false')
    expect(builder).toContain('uiohook-napi')
    expect(builder).toContain('npmRebuild: false')
    expect(builder).toContain('**/*.node')
    expect(builder).toContain('resources/brain')
    expect(builder).toContain('!**/*.gguf')
    expect(yaml).toContain('fetch-brain.mjs')
    expect(yaml).toContain('resources/brain')
    const runs = yaml.split('\n').filter((line) => line.includes('run:'))
    expect(runs.join('\n')).not.toContain('--publish never')
  })
})
