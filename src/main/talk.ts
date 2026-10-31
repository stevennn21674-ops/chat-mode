import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downsample, encodeWavPcm16 } from '../shared/audio'
import { whisperLocation } from './paths'
import { transcribeFile } from './transcribe'

interface TalkDeps {
  voice: BrowserWindow
  voiceEnabled: () => boolean
  chatEnabled: () => boolean
  deviceId: () => string
  onLive: (live: boolean) => void
  onNote: (note: string | null) => void
  onTranscript: (text: string) => void
  log: (message: string) => void
}

export class TalkController {
  private holding = false
  private recording = false
  private capTimer: NodeJS.Timeout | null = null

  constructor(private deps: TalkDeps) {}

  keyDown(): void {
    if (this.holding) return
    this.holding = true
    if (!this.deps.chatEnabled() || !this.deps.voiceEnabled()) return
    this.start()
  }

  keyUp(): void {
    if (!this.holding) return
    this.holding = false
    this.stop()
    this.deps.onLive(false)
  }

  modelReady(): boolean {
    return whisperLocation() !== null
  }

  private start(): void {
    if (this.recording || this.deps.voice.isDestroyed()) return
    this.recording = true
    this.deps.onLive(true)
    this.deps.voice.webContents.send('voice:command', {
      type: 'start',
      deviceId: this.deps.deviceId()
    })
    this.capTimer = setTimeout(() => this.stop(), 20000)
  }

  private stop(): void {
    if (!this.recording || this.deps.voice.isDestroyed()) return
    this.recording = false
    if (this.capTimer) clearTimeout(this.capTimer)
    this.capTimer = null
    this.deps.voice.webContents.send('voice:command', { type: 'stop' })
    if (this.holding) this.deps.onLive(true)
  }

  async audio(sampleRate: number, pcm: Float32Array): Promise<void> {
    const samples = downsample(pcm, sampleRate, 16000)
    if (samples.length < 16000 * 0.35) return
    const where = whisperLocation()
    if (!where) {
      this.deps.onNote('Speech model is not installed')
      return
    }
    const wavPath = join(tmpdir(), `chatmode-${randomUUID()}.wav`)
    try {
      writeFileSync(wavPath, encodeWavPcm16(samples, 16000))
      const text = await transcribeFile(where.bin, where.model, wavPath)
      if (text) this.deps.onTranscript(text)
    } catch {
      this.deps.log('transcription failed')
      this.deps.onNote('Could not transcribe that')
    } finally {
      try {
        unlinkSync(wavPath)
      } catch {
        // The clip is already gone.
      }
    }
  }
}

export function asFloat32(value: unknown): Float32Array | null {
  if (value instanceof Float32Array) return value
  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) return Float32Array.from(value)
  return null
}
