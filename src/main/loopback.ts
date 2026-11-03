import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain, type BrowserWindow } from 'electron'
import { downsample, encodeWavPcm16, isLoudPcm, isSilentPcm } from '../shared/audio'
import { whisperLocation } from './paths'
import { asFloat32 } from './talk'
import { transcribeFile } from './transcribe'

export class LoopbackController {
  private enabled = false

  constructor(
    private voice: BrowserWindow,
    private log: (message: string) => void
  ) {}

  setEnabled(on: boolean): void {
    if (this.enabled === on) return
    this.enabled = on
    if (this.voice.isDestroyed()) return
    this.voice.webContents.send('voice:command', { type: on ? 'loopback-start' : 'loopback-stop' })
  }

  async transcript(): Promise<{ text: string; loud: boolean }> {
    if (!this.enabled || this.voice.isDestroyed()) return { text: '', loud: false }
    const clip = await this.take()
    if (!clip) return { text: '', loud: false }
    const samples = downsample(clip.pcm, clip.sampleRate, 16000)
    const loud = isLoudPcm(samples)
    if (samples.length < 8000 || isSilentPcm(samples)) return { text: '', loud: false }
    const where = whisperLocation()
    if (!where) return { text: '', loud }
    const wavPath = join(tmpdir(), `chatmode-pc-${randomUUID()}.wav`)
    try {
      writeFileSync(wavPath, encodeWavPcm16(samples, 16000))
      return { text: await transcribeFile(where.bin, where.model, wavPath), loud }
    } catch {
      this.log('computer audio transcription failed')
      return { text: '', loud }
    } finally {
      try {
        unlinkSync(wavPath)
      } catch {
        // The clip is already gone.
      }
    }
  }

  private take(): Promise<{ sampleRate: number; pcm: Float32Array } | null> {
    if (this.voice.isDestroyed()) return Promise.resolve(null)
    return new Promise((resolve) => {
      const onClip = (_event: unknown, payload: unknown): void => {
        clearTimeout(timer)
        const record = payload && typeof payload === 'object' ? (payload as { sampleRate?: unknown; pcm?: unknown }) : {}
        const pcm = asFloat32(record.pcm)
        const sampleRate = typeof record.sampleRate === 'number' ? record.sampleRate : 0
        if (!pcm || sampleRate <= 0 || pcm.length === 0) resolve(null)
        else resolve({ sampleRate, pcm })
      }
      const timer = setTimeout(() => {
        ipcMain.removeListener('voice:loopback', onClip)
        resolve(null)
      }, 2000)
      ipcMain.once('voice:loopback', onClip)
      this.voice.webContents.send('voice:command', { type: 'loopback-take' })
    })
  }
}
