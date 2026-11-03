import { describe, expect, it } from 'vitest'
import {
  activityLines,
  allowAutoVision,
  classifyActivity,
  detectGame,
  sampleFrame,
  shouldSample,
  watchIntervalMs
} from '../src/shared/screen-activity'

function solid(r: number, g: number, b: number, pixels = 64 * 36): Uint8Array {
  const bytes = new Uint8Array(pixels * 4)
  for (let i = 0; i < pixels; i++) {
    bytes[i * 4] = b
    bytes[i * 4 + 1] = g
    bytes[i * 4 + 2] = r
  }
  return bytes
}

describe('screen activity', () => {
  it('classifies still, motion, dark, scare, death, and a known game', () => {
    const gray = solid(120, 120, 120)
    const still = sampleFrame(gray, gray)
    expect(classifyActivity({ sample: still, previous: still, title: 'Roblox', stillFrames: 3 }).state).toBe('idle')
    expect(detectGame('Roblox')).toBe('Roblox')
    expect(detectGame('Escape the Backrooms - Game')).toBe('Escape the Backrooms')
    expect(detectGame('Friday Night Funkin')).toBe('FNF')
    const black = sampleFrame(solid(0, 0, 0), null)
    expect(classifyActivity({ sample: black, previous: null, title: null, stillFrames: 0 }).state).toBe('dark')
    const bright = sampleFrame(solid(240, 240, 240), null)
    const cut = { ...bright, motion: 0.8 }
    expect(classifyActivity({ sample: cut, previous: still, title: 'Minecraft', stillFrames: 0 }).state).toBe('scare')
    const red = sampleFrame(solid(220, 20, 20), gray)
    expect(classifyActivity({ sample: { ...red, motion: 0.5 }, previous: { ...still, motion: 0.3 }, title: null, stillFrames: 0 }).state).toBe('death')
    expect(classifyActivity({ sample: still, previous: still, title: 'Victory Royale - Fortnite', stillFrames: 0 }).state).toBe('victory')
    expect(classifyActivity({ sample: still, previous: still, title: 'Victory Royale - Fortnite', stillFrames: 0 }).game).toBe('Fortnite')
  })

  it('uses on-topic lines and stays quiet on battery or when idle', () => {
    expect(activityLines('scare', null).join(' ')).toMatch(/WAIT WHAT WAS THAT/)
    expect(activityLines('dark', 'Minecraft').join(' ')).toMatch(/dark again lol/)
    expect(activityLines('exploring', null).join(' ')).toMatch(/running/)
    expect(activityLines('idle', null).join(' ')).toMatch(/stopped moving/)
    expect(activityLines('death', null).join(' ')).toMatch(/died/)
    expect(shouldSample({ enabled: true, chatEnabled: true, onBattery: true, pauseOnBattery: true, idle: false })).toBe(false)
    expect(shouldSample({ enabled: true, chatEnabled: true, onBattery: false, pauseOnBattery: true, idle: true })).toBe(false)
    expect(shouldSample({ enabled: true, chatEnabled: true, onBattery: false, pauseOnBattery: true, idle: false })).toBe(true)
    expect(watchIntervalMs(0)).toBeLessThan(watchIntervalMs(8))
    expect(allowAutoVision({ aiMode: true, autoVision: false, offline: false, big: true, usedThisHour: 0, cap: 6 })).toBe(false)
    expect(allowAutoVision({ aiMode: true, autoVision: true, offline: false, big: true, usedThisHour: 6, cap: 6 })).toBe(false)
    expect(allowAutoVision({ aiMode: true, autoVision: true, offline: false, big: true, usedThisHour: 1, cap: 6 })).toBe(true)
    expect(allowAutoVision({
      aiMode: true,
      autoVision: true,
      offline: false,
      big: true,
      usedThisHour: 1,
      cap: 6,
      serviceCalls: 19,
      serviceCap: 20,
      reserveForVoice: true
    })).toBe(false)
    expect(allowAutoVision({
      aiMode: true,
      autoVision: true,
      offline: false,
      big: true,
      usedThisHour: 0,
      cap: 6,
      serviceCalls: 2,
      serviceCap: 20,
      reserveForVoice: true
    })).toBe(true)
    expect(allowAutoVision({ aiMode: false, autoVision: true, offline: false, big: true, usedThisHour: 0, cap: 6 })).toBe(false)
  })
})
