import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clampPlacement, defaultPlacement } from '../src/shared/placement'
import { applyPatch, DEFAULT_SETTINGS, usableProxyUrl } from '../src/shared/settings'
import { readSettingsFile, writeSettingsFile } from '../src/shared/settings-file'

describe('settings persistence', () => {
  it('merges partial values and ignores junk', () => {
    const next = applyPatch(DEFAULT_SETTINGS, {
      speedLevel: 9,
      opacity: 0.1,
      fontSize: 30,
      proxyUrl: '  https://relay.example/v1  ',
      proxyToken: 'abc\n',
      extra: 'nope',
      enabled: false,
      x: 12.4
    })
    expect(next.speedLevel).toBe(7)
    expect(next.opacity).toBe(0.45)
    expect(next.fontSize).toBe(22)
    expect(next.proxyUrl).toBe('https://relay.example/v1')
    expect(next.proxyToken).toBe('abc')
    expect(next.enabled).toBe(false)
    expect(next.x).toBe(12)
    expect(next.ecoMode).toBe(true)
    expect(next.captureIntervalSec).toBe(25)
    expect(next.maxCallsPerHour).toBe(20)
    const bounded = applyPatch(DEFAULT_SETTINGS, {
      captureIntervalSec: 5,
      maxCallsPerHour: 999,
      ecoMode: false,
      apiKey: 'super-secret-value'
    })
    expect(bounded.captureIntervalSec).toBe(15)
    expect(bounded.maxCallsPerHour).toBe(120)
    expect(bounded.ecoMode).toBe(false)
    expect(JSON.stringify(bounded)).not.toContain('super-secret-value')
    expect(usableProxyUrl('ftp://nope')).toBe('')
    expect(usableProxyUrl('https://relay.example/v1/')).toBe('https://relay.example/v1')
  })

  it('round-trips a file and recovers from corruption', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatmode-settings-'))
    const file = join(dir, 'settings.json')
    const saved = applyPatch(DEFAULT_SETTINGS, { speedLevel: 2, opacity: 0.7, x: 40, y: 80 })
    writeSettingsFile(file, saved)
    expect(readSettingsFile(file)).toMatchObject({ speedLevel: 2, opacity: 0.7, x: 40, y: 80 })

    writeFileSync(file, '{not json')
    expect(readSettingsFile(file).speedLevel).toBe(DEFAULT_SETTINGS.speedLevel)
    expect(readFileSync(`${file}.corrupt`, 'utf8')).toContain('not json')
  })
})

describe('placement', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1080 }
  const size = { width: 360, height: 640 }

  it('defaults to the right side and pulls lost windows back', () => {
    expect(defaultPlacement(work, size)).toEqual({ x: 1536, y: 220 })
    expect(clampPlacement({ x: 1400, y: 100 }, size, [work])).toEqual({ x: 1400, y: 100 })
    expect(clampPlacement({ x: -4000, y: 50 }, size, [work])).toEqual({ x: 1536, y: 220 })
  })
})
