import type { MicDevice } from '@shared/types'

interface VoiceBridge {
  onCommand(callback: (command: { type: 'start'; deviceId: string } | { type: 'stop' } | { type: 'list' }) => void): void
  submitAudio(payload: { sampleRate: number; pcm: Float32Array }): void
  submitDevices(devices: MicDevice[]): void
  submitError(code: 'denied' | 'failed'): void
}

declare global {
  interface Window {
    voice: VoiceBridge
  }
}

let stream: MediaStream | null = null
let context: AudioContext | null = null
let processor: ScriptProcessorNode | null = null
let gain: GainNode | null = null
let chunks: Float32Array[] = []

async function teardown(send: boolean): Promise<void> {
  const rate = context?.sampleRate ?? 48000
  processor?.disconnect()
  gain?.disconnect()
  stream?.getTracks().forEach((track) => track.stop())
  const current = context
  processor = null
  gain = null
  stream = null
  context = null
  const recorded = chunks
  chunks = []
  if (current) await current.close().catch(() => undefined)
  if (!send) return
  const length = recorded.reduce((sum, chunk) => sum + chunk.length, 0)
  if (!length) return
  const merged = new Float32Array(length)
  let offset = 0
  for (const chunk of recorded) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  window.voice.submitAudio({ sampleRate: rate, pcm: merged })
}

async function start(deviceId: string): Promise<void> {
  await teardown(false)
  const audio: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true
  }
  if (deviceId) audio.deviceId = { exact: deviceId }
  stream = await navigator.mediaDevices.getUserMedia({ audio })
  context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  processor = context.createScriptProcessor(4096, 1, 1)
  gain = context.createGain()
  gain.gain.value = 0
  chunks = []
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  }
  source.connect(processor)
  processor.connect(gain)
  gain.connect(context.destination)
}

async function listDevices(): Promise<void> {
  try {
    const warmup = await navigator.mediaDevices.getUserMedia({ audio: true })
    warmup.getTracks().forEach((track) => track.stop())
  } catch {
    window.voice.submitError('denied')
  }
  const devices = await navigator.mediaDevices.enumerateDevices()
  window.voice.submitDevices(
    devices
      .filter((device) => device.kind === 'audioinput')
      .map((device) => ({ deviceId: device.deviceId, label: device.label || 'Microphone' }))
  )
}

window.voice.onCommand((command) => {
  if (command.type === 'list') {
    void listDevices()
    return
  }
  if (command.type === 'start') {
    void start(command.deviceId).catch(() => window.voice.submitError('failed'))
    return
  }
  void teardown(true)
})
