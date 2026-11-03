import type { BrowserWindow } from 'electron'
import type { MicDevice } from '../shared/types'
import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asFloat32, downsample, encodeWavPcm16, pcmRms, trimSpeech } from '../shared/audio'
import { MIC_SILENT, chooseMicrophone, micStages, type MicStage } from '../shared/mic'
import { whisperLocation } from './paths'
import { transcribeFile } from './transcribe'

interface TalkDeps {
  voice: BrowserWindow
  voiceEnabled: () => boolean
  chatEnabled: () => boolean
  deviceId: () => string
  mode: () => 'hold' | 'toggle' | 'vad'
  onLive: (live: boolean) => void
  onLevel: (level: number) => void
  onNote: (note: string | null) => void
  onFault: (reason: string) => void
  onRelease: () => void
  onTranscript: (text: string) => void
  log: (message: string) => void
}

const TAIL_MS = 450

export class TalkController {
  private holding = false
  private recording = false
  private testing = false
  private capTimer: NodeJS.Timeout | null = null
  private tailTimer: NodeJS.Timeout | null = null
  private testWait: ((result: { ok: boolean; detail: string }) => void) | null = null
  private diagnoseWait: ((result: { ok: boolean; detail: string; rms: number }) => void) | null = null
  private vadHot = false

  constructor(private deps: TalkDeps) {}

  keyDown(): void {
    if (this.testing) return
    const mode = this.deps.mode()
    if (mode === 'vad') return
    if (mode === 'toggle') {
      if (this.recording || this.holding) {
        this.holding = false
        this.stop(true)
        return
      }
      this.holding = true
      if (!this.deps.chatEnabled() || !this.deps.voiceEnabled()) return
      this.start('talk')
      return
    }
    if (this.holding) return
    this.holding = true
    if (!this.deps.chatEnabled() || !this.deps.voiceEnabled()) return
    this.start('talk')
  }

  keyUp(): void {
    if (this.deps.mode() !== 'hold') return
    if (!this.holding) return
    const wasRecording = this.recording
    this.holding = false
    if (wasRecording) this.deps.onRelease()
    this.stop(false)
  }

  fallbackPress(): void {
    if (this.testing) return
    if (this.recording || this.holding) {
      this.holding = false
      if (this.recording) this.deps.onRelease()
      this.stop(true)
      return
    }
    this.keyDown()
    if (this.deps.mode() === 'hold') this.holding = true
  }

  modelReady(): boolean {
    return whisperLocation() !== null
  }

  testMic(): Promise<{ ok: boolean; detail: string }> {
    if (this.recording || this.testing) return Promise.resolve({ ok: false, detail: 'The mic is already in use.' })
    if (!this.modelReady()) return Promise.resolve({ ok: false, detail: 'mic not working: speech model is not installed' })
    this.testing = true
    this.deps.log('test mic start')
    this.deps.onLive(true)
    this.start('test')
    return new Promise((resolve) => {
      const finish = (result: { ok: boolean; detail: string }): void => {
        if (this.testWait !== finish) return
        this.testWait = null
        this.testing = false
        this.deps.onLive(false)
        this.deps.onLevel(0)
        resolve(result)
      }
      this.testWait = finish
      setTimeout(() => finish({ ok: false, detail: 'mic not working: test timed out' }), 15000)
    })
  }

  private start(kind: 'talk' | 'test'): void {
    if (this.recording || this.deps.voice.isDestroyed()) return
    this.recording = true
    this.deps.onLive(true)
    this.deps.log(`${kind} start device=${this.deps.deviceId() || 'default'}`)
    const command = kind === 'test'
      ? { type: 'test' as const, deviceId: this.deps.deviceId(), ms: 3000 }
      : { type: 'start' as const, deviceId: this.deps.deviceId() }
    this.deps.voice.webContents.send('voice:command', command)
    this.capTimer = setTimeout(() => this.stop(true), kind === 'test' ? 4000 : 20000)
  }

  private stop(immediate: boolean): void {
    if (!this.recording) return
    if (!immediate) {
      if (this.tailTimer) return
      this.tailTimer = setTimeout(() => {
        this.tailTimer = null
        this.finishStop()
      }, TAIL_MS)
      return
    }
    this.finishStop()
  }

  private finishStop(): void {
    if (!this.recording || this.deps.voice.isDestroyed()) return
    this.recording = false
    if (this.capTimer) clearTimeout(this.capTimer)
    this.capTimer = null
    if (this.tailTimer) clearTimeout(this.tailTimer)
    this.tailTimer = null
    this.deps.voice.webContents.send('voice:command', { type: 'stop' })
    if (!this.holding && !this.testing) {
      this.deps.onLive(false)
      this.deps.onLevel(0)
    }
  }

  level(value: number): void {
    const next = Math.max(0, Math.min(1, value))
    if (this.deps.mode() === 'vad' && !this.recording && !this.testing) {
      const hot = next >= 0.08
      if (hot !== this.vadHot) {
        this.vadHot = hot
        this.deps.onLive(hot)
      }
      this.deps.onLevel(hot ? next : 0)
      return
    }
    if (!this.recording && !this.holding) return
    this.deps.onLevel(next)
  }

  fail(reason: string): void {
    this.recording = false
    this.holding = false
    this.vadHot = false
    this.deps.onLive(false)
    this.deps.onLevel(0)
    this.deps.log(`mic not working: ${reason}`)
    this.deps.onFault(reason)
    const detail = `mic not working: ${reason}`
    this.testWait?.({ ok: false, detail })
    this.testWait = null
    this.diagnoseWait?.({ ok: false, detail, rms: 0 })
    this.diagnoseWait = null
    this.testing = false
  }

  async diagnose(input: { access: string; hookReady: boolean; devices: MicDevice[] }): Promise<MicStage[]> {
    const chosen = chooseMicrophone(input.devices, this.deps.deviceId())
    const picked = input.devices.find((device) => device.deviceId === chosen)
    const label = picked?.label || (chosen ? 'Microphone' : 'System default')
    if (this.recording || this.testing) {
      return micStages({
        access: input.access,
        openError: 'The mic is already in use.',
        deviceLabel: label,
        deviceCount: input.devices.length,
        savedVirtual: false,
        peakRms: null,
        hookReady: input.hookReady,
        modelReady: this.modelReady(),
        transcript: '',
        transcriptError: 'Not run.'
      })
    }
    this.testing = true
    this.deps.log('mic diagnostics start')
    this.deps.onLive(true)
    const result = await new Promise<{ ok: boolean; detail: string; rms: number }>((resolve) => {
      this.diagnoseWait = resolve
      this.deps.voice.webContents.send('voice:command', {
        type: 'test',
        deviceId: chosen || this.deps.deviceId(),
        ms: 1600,
        purpose: 'diagnose'
      })
      setTimeout(() => resolve({ ok: false, detail: 'mic not working: test timed out', rms: 0 }), 8000)
    })
    this.diagnoseWait = null
    this.testing = false
    this.deps.onLive(false)
    this.deps.onLevel(0)
    const openError = /permission denied|No microphone was found|failed to open/i.test(result.detail) ? result.detail : null
    const silent = result.rms < 0.004
    return micStages({
      access: input.access,
      openError,
      deviceLabel: label,
      deviceCount: input.devices.length,
      savedVirtual: Boolean(picked && /stereo mix|virtual|cable|vb-audio|loopback/i.test(picked.label)),
      peakRms: openError ? null : result.rms,
      hookReady: input.hookReady,
      modelReady: this.modelReady(),
      transcript: result.ok ? result.detail : '',
      transcriptError: result.ok ? null : silent ? MIC_SILENT : result.detail
    })
  }

  private finishDiagnose(result: { ok: boolean; detail: string; rms: number }): void {
    this.testing = false
    this.recording = false
    this.deps.onLive(false)
    this.deps.onLevel(0)
    if (!result.ok) this.deps.onFault(result.detail.replace(/^mic not working:\s*/, ''))
    const wait = this.diagnoseWait
    this.diagnoseWait = null
    wait?.(result)
  }

  async audio(sampleRate: number, pcm: Float32Array, purpose: 'talk' | 'test' | 'diagnose' = 'talk'): Promise<void> {
    const samples = trimSpeech(downsample(pcm, sampleRate, 16000), 16000)
    const rms = pcmRms(pcm)
    this.deps.log(`audio purpose=${purpose} rate=${Math.round(sampleRate)} in=${pcm.length} out=${samples.length} rms=${rms.toFixed(4)}`)
    if (pcm.length < 1600) {
      this.fail('clip too short')
      return
    }
    if (!samples.length || rms < 0.004) {
      if (purpose === 'diagnose') {
        this.finishDiagnose({ ok: false, detail: MIC_SILENT, rms })
        return
      }
      this.fail(MIC_SILENT)
      return
    }
    if (samples.length < 16000 * 0.25) {
      this.fail('clip too short')
      return
    }
    const where = whisperLocation()
    if (!where) {
      this.deps.log('whisper files missing')
      if (purpose === 'diagnose') {
        this.finishDiagnose({ ok: false, detail: 'Speech model is not installed.', rms })
        return
      }
      this.fail('speech model is not installed')
      return
    }
    this.deps.log(`whisper bin=${where.bin} model=${where.model}`)
    const wavPath = join(tmpdir(), `chatmode-${randomUUID()}.wav`)
    try {
      writeFileSync(wavPath, encodeWavPcm16(samples, 16000))
      const text = await transcribeFile(where.bin, where.model, wavPath, 20000, true)
      this.deps.log(`transcript: ${text || '(empty)'}`)
      if (!text) {
        if (purpose === 'diagnose') {
          this.finishDiagnose({ ok: false, detail: 'Nothing was recognized.', rms })
          return
        }
        this.fail('nothing was recognized')
        return
      }
      if (purpose === 'diagnose') {
        this.finishDiagnose({ ok: true, detail: text, rms })
        return
      }
      if (purpose === 'test') {
        this.testWait?.({ ok: true, detail: text })
        this.testWait = null
        this.testing = false
        this.deps.onLive(false)
        return
      }
      this.deps.onTranscript(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'transcription failed'
      this.deps.log(`whisper error: ${message}`)
      const reason = /timed out/i.test(message) ? 'transcription timed out' : /ENOENT|spawn/i.test(message) ? 'speech program missing' : 'transcription failed'
      if (purpose === 'diagnose') {
        this.finishDiagnose({ ok: false, detail: reason, rms })
        return
      }
      this.fail(reason)
    } finally {
      try {
        unlinkSync(wavPath)
      } catch {
        // The clip is already gone.
      }
    }
  }
}

export { asFloat32 }
