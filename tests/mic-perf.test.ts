import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { trimSpeech } from '../src/shared/audio'
import {
  chooseMicrophone,
  describeMicFailure,
  hookTalkAction,
  isVirtualInput,
  MIC_PRIVACY_FIX,
  MIC_SILENT,
  micConstraints,
  micStages,
  normalizeTalkKey,
  vadStep
} from '../src/shared/mic'
import { excludedCoreFiles, OCR_RUNTIME_PACKAGES, unpackGaps } from '../src/shared/ocr-unpack'
import { cpuAverage, effectiveMode, perfProfile, shouldThrottle } from '../src/shared/performance'
import { applyPatch, DEFAULT_SETTINGS } from '../src/shared/settings'

describe('microphone selection and errors', () => {
  it('keeps a saved device and skips a virtual default', () => {
    const devices = [
      { deviceId: 'default', label: 'Default - Stereo Mix (Virtual Cable)' },
      { deviceId: 'mic-1', label: 'Microphone (Realtek)' },
      { deviceId: 'cable', label: 'CABLE Output (VB-Audio)' }
    ]
    expect(isVirtualInput('Stereo Mix')).toBe(true)
    expect(isVirtualInput('Microphone (Realtek)')).toBe(false)
    expect(chooseMicrophone(devices, '')).toBe('mic-1')
    expect(chooseMicrophone(devices, 'cable')).toBe('cable')
    expect(chooseMicrophone(devices, 'missing')).toBe('mic-1')
    expect(normalizeTalkKey('b')).toBe('B')
    expect(normalizeTalkKey('')).toBe('V')
    expect(micConstraints('mic-1').echoCancellation).toBe(false)
    expect(micConstraints('mic-1').noiseSuppression).toBe(false)
    expect(micConstraints('mic-1').autoGainControl).toBe(true)
    expect(micConstraints('').deviceId).toBeUndefined()
  })

  it('names the Windows privacy fix and a silent mic', () => {
    const denied = describeMicFailure('NotAllowedError', 'Permission denied')
    expect(denied.code).toBe('denied')
    expect(denied.detail).toContain(MIC_PRIVACY_FIX)
    expect(describeMicFailure('NotFoundError').code).toBe('missing')
    expect(describeMicFailure('', 'mic is silent').code).toBe('silent')
    const stages = micStages({
      access: 'denied',
      openError: denied.detail,
      deviceLabel: 'Microphone',
      deviceCount: 1,
      savedVirtual: false,
      peakRms: 0,
      hookReady: true,
      modelReady: true,
      transcript: '',
      transcriptError: null
    })
    expect(stages.find((stage) => stage.id === 'permission')?.pass).toBe(false)
    expect(stages.find((stage) => stage.id === 'level')?.detail).toContain(denied.detail)
    const heard = micStages({
      access: 'granted',
      openError: null,
      deviceLabel: 'Microphone (Realtek)',
      deviceCount: 1,
      savedVirtual: false,
      peakRms: 0.05,
      hookReady: false,
      modelReady: true,
      transcript: 'hello',
      transcriptError: null
    })
    expect(heard.map((stage) => stage.pass)).toEqual([true, true, true, false, true])
    expect(heard.find((stage) => stage.id === 'transcription')?.detail).toBe('heard: hello')
    expect(MIC_SILENT).toMatch(/mic is silent/)
  })

  it('ignores key repeat and emits voice activity once', () => {
    expect(hookTalkAction({ repeat: true, down: true, mode: 'hold', held: false })).toBe('ignore')
    expect(hookTalkAction({ repeat: false, down: true, mode: 'hold', held: false })).toBe('down')
    expect(hookTalkAction({ repeat: false, down: true, mode: 'hold', held: true })).toBe('ignore')
    expect(hookTalkAction({ repeat: false, down: false, mode: 'hold', held: true })).toBe('up')
    expect(hookTalkAction({ repeat: false, down: true, mode: 'toggle', held: false })).toBe('down')
    expect(hookTalkAction({ repeat: false, down: true, mode: 'toggle', held: true })).toBe('up')
    expect(hookTalkAction({ repeat: false, down: false, mode: 'toggle', held: true })).toBe('ignore')
    expect(hookTalkAction({ repeat: false, down: true, mode: 'vad', held: false })).toBe('ignore')
    expect(vadStep({ rms: 0.001, speaking: false, loudMs: 0, silentMs: 0, frameMs: 100, speechMs: 0 }).speaking).toBe(false)
    const started = vadStep({ rms: 0.04, speaking: false, loudMs: 200, silentMs: 0, frameMs: 100, speechMs: 0 })
    expect(started.speaking).toBe(true)
    expect(started.emit).toBe(false)
    const ended = vadStep({ rms: 0.001, speaking: true, loudMs: 300, silentMs: 650, frameMs: 80, speechMs: 1000 })
    expect(ended.emit).toBe(true)
    expect(ended.speaking).toBe(false)
  })
})

describe('performance mode', () => {
  it('defaults low and backs off when the machine is busy', () => {
    expect(DEFAULT_SETTINGS.performanceMode).toBe('low')
    expect(DEFAULT_SETTINGS.talkMode).toBe('hold')
    expect(DEFAULT_SETTINGS.talkKey).toBe('V')
    expect(DEFAULT_SETTINGS.overlayGpu).toBe(true)
    expect(applyPatch(DEFAULT_SETTINGS, { performanceMode: 'high', talkMode: 'vad', talkKey: 'b', overlayGpu: false })).toMatchObject({
      performanceMode: 'high',
      talkMode: 'vad',
      talkKey: 'B',
      overlayGpu: false
    })
    expect(applyPatch(DEFAULT_SETTINGS, { performanceMode: 'turbo', talkMode: 'push', talkKey: '!!' }).performanceMode).toBe('low')
    expect(perfProfile('low').loopback).toBe(false)
    expect(perfProfile('low').watchBaseMs).toBeGreaterThan(1000)
    expect(perfProfile('balanced').loopbackEveryMs).toBeGreaterThanOrEqual(30_000)
    expect(perfProfile('high').loopbackEveryMs).toBe(30_000)
    expect(shouldThrottle(71, 60)).toBe(true)
    expect(shouldThrottle(20, 18)).toBe(true)
    expect(shouldThrottle(20, 40)).toBe(false)
    expect(cpuAverage([60, 80])).toBe(70)
    expect(effectiveMode('high', true)).toBe('balanced')
    expect(effectiveMode('balanced', true)).toBe('low')
  })
})

describe('speech trim and ocr packaging', () => {
  it('does not throw away a quiet clip that still has speech', () => {
    const quiet = new Float32Array(16000)
    for (let i = 4000; i < 12000; i += 1) quiet[i] = 0.008
    const kept = trimSpeech(quiet, 16000)
    expect(kept.length).toBeGreaterThan(1000)
  })

  it('unpacks the tesseract worker tree and keeps the lstm cores', () => {
    const yaml = readFileSync(join(import.meta.dirname, '../electron-builder.yml'), 'utf8')
    expect(unpackGaps(yaml)).toEqual([])
    expect(excludedCoreFiles(yaml)).toEqual([])
    expect(OCR_RUNTIME_PACKAGES).toContain('node-fetch')
    expect(OCR_RUNTIME_PACKAGES).toContain('whatwg-url')
  })
})
