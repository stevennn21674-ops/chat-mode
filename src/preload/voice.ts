import { contextBridge, ipcRenderer } from 'electron'
import type { MicDevice } from '../shared/types'

type VoiceCommand =
  | { type: 'start'; deviceId: string }
  | { type: 'stop' }
  | { type: 'list' }
  | { type: 'loopback-start' }
  | { type: 'loopback-stop' }
  | { type: 'loopback-take' }

contextBridge.exposeInMainWorld('voice', {
  onCommand(callback: (command: VoiceCommand) => void): void {
    ipcRenderer.on('voice:command', (_event, command: VoiceCommand) => callback(command))
  },
  submitAudio(payload: { sampleRate: number; pcm: Float32Array }): void {
    ipcRenderer.send('voice:audio', payload)
  },
  submitDevices(devices: MicDevice[]): void {
    ipcRenderer.send('voice:devices', devices)
  },
  submitError(code: 'denied' | 'failed'): void {
    ipcRenderer.send('voice:error', code)
  },
  submitLoopback(payload: { sampleRate: number; pcm: Float32Array }): void {
    ipcRenderer.send('voice:loopback', payload)
  },
  submitPcAudio(code: 'unavailable'): void {
    ipcRenderer.send('voice:pc-audio', code)
  }
})
