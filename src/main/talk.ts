import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asFloat32, downsample, encodeWavPcm16, pcmRms, trimSilence } from '../shared/audio'
import { whisperLocation } from './paths'
import { transcribeFile } from './transcribe'

interface TalkDeps {
  voice: BrowserWindow
  voiceEnabled: () => boolean
  chatEnabled: () => boolean
  deviceId: () => string
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

  constructor(private deps: TalkDeps) {}

  keyDown(): void {
    if (this.holding || this.testing) return
    this.holding = true
    if (!this.deps.chatEnabled() || !this.deps.voiceEnabled()) return
    this.start('talk')
  }

  keyUp(): void {
    if (!this.holding) return
    const wasRecording = this.recording
    this.holding = false
    if (wasRecording) this.deps.onRelease()
    this.stop(false)
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
    if (!this.recording && !this.holding) return
    this.deps.onLevel(Math.max(0, Math.min(1, value)))
  }

  fail(reason: string): void {
    this.recording = false
    this.holding = false
    this.deps.onLive(false)
    this.deps.onLevel(0)
    this.deps.log(`mic not working: ${reason}`)
    this.deps.onFault(reason)
    this.testWait?.({ ok: false, detail: `mic not working: ${reason}` })
    this.testWait = null
    this.testing = false
  }

  async audio(sampleRate: number, pcm: Float32Array, purpose: 'talk' | 'test' = 'talk'): Promise<void> {
    const samples = trimSilence(downsample(pcm, sampleRate, 16000), 16000)
    const rms = pcmRms(pcm)
    this.deps.log(`audio purpose=${purpose} rate=${Math.round(sampleRate)} in=${pcm.length} out=${samples.length} rms=${rms.toFixed(4)}`)
    if (pcm.length < 1600) {
      this.fail('clip too short')
      return
    }
    if (!samples.length || rms < 0.004) {
      this.fail('no sound from the microphone')
      return
    }
    if (samples.length < 16000 * 0.25) {
      this.fail('clip too short')
      return
    }
    const where = whisperLocation()
    if (!where) {
      this.deps.log('whisper files missing')
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
        this.fail('nothing was recognized')
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
      if (/timed out/i.test(message)) this.fail('transcription timed out')
      else if (/ENOENT|spawn/i.test(message)) this.fail('speech program missing')
      else this.fail('transcription failed')
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
