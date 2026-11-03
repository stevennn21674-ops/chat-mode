import { downsample, PcmWindow } from '@shared/audio'
import type { MicDevice } from '@shared/types'

interface VoiceBridge {
  onCommand(
    callback: (
      command:
        | { type: 'start'; deviceId: string }
        | { type: 'stop' }
        | { type: 'test'; deviceId: string; ms: number }
        | { type: 'list' }
        | { type: 'loopback-start' }
        | { type: 'loopback-stop' }
        | { type: 'loopback-take' }
    ) => void
  ): void
  submitAudio(payload: { sampleRate: number; pcm: Uint8Array; encoding: 'f32le'; purpose: 'talk' | 'test' }): void
  submitLevel(level: number): void
  submitDevices(devices: MicDevice[]): void
  submitError(code: 'denied' | 'failed' | 'empty'): void
  submitLoopback(payload: { sampleRate: number; pcm: Float32Array }): void
  submitPcAudio(code: 'unavailable'): void
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
let purpose: 'talk' | 'test' = 'talk'
let levelAt = 0

const pcAudio = new PcmWindow(18)
let loopStream: MediaStream | null = null
let loopContext: AudioContext | null = null
let loopProcessor: ScriptProcessorNode | null = null
let loopGain: GainNode | null = null
let loopWanted = false
let loopNoted = false
let loopGen = 0
let loopRetries = 0

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
  if (!length) {
    window.voice.submitError('empty')
    window.voice.submitLevel(0)
    return
  }
  const merged = new Float32Array(length)
  let offset = 0
  for (const chunk of recorded) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  const bytes = new Uint8Array(merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength))
  window.voice.submitAudio({ sampleRate: rate, pcm: bytes, encoding: 'f32le', purpose })
  window.voice.submitLevel(0)
}

function constraints(deviceId: string): MediaTrackConstraints {
  const audio: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
  if (deviceId) audio.deviceId = { exact: deviceId }
  return audio
}

async function openMic(deviceId: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: constraints(deviceId) })
  } catch (error) {
    if (!deviceId) throw error
    return navigator.mediaDevices.getUserMedia({ audio: constraints('') })
  }
}

async function start(deviceId: string): Promise<void> {
  await teardown(false)
  stream = await openMic(deviceId)
  context = new AudioContext()
  if (context.state === 'suspended') await context.resume()
  if (context.state === 'suspended') throw new Error('audio context suspended')
  const source = context.createMediaStreamSource(stream)
  processor = context.createScriptProcessor(4096, 1, 1)
  gain = context.createGain()
  gain.gain.value = 0
  chunks = []
  levelAt = 0
  processor.onaudioprocess = (event) => {
    const data = event.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(data))
    const now = performance.now()
    if (now - levelAt < 80) return
    levelAt = now
    let sum = 0
    const step = Math.max(1, Math.floor(data.length / 200))
    let count = 0
    for (let i = 0; i < data.length; i += step) {
      const sample = data[i] ?? 0
      sum += sample * sample
      count += 1
    }
    const rms = count ? Math.sqrt(sum / count) : 0
    window.voice.submitLevel(Math.max(0, Math.min(1, rms * 4)))
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

async function closeLoopback(): Promise<void> {
  loopProcessor?.disconnect()
  loopGain?.disconnect()
  loopStream?.getTracks().forEach((track) => track.stop())
  const current = loopContext
  loopProcessor = null
  loopGain = null
  loopStream = null
  loopContext = null
  pcAudio.clear()
  if (current) await current.close().catch(() => undefined)
}

async function startLoopback(): Promise<void> {
  loopWanted = true
  const gen = ++loopGen
  await closeLoopback()
  if (!loopWanted || gen !== loopGen) return
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 16, height: 16, frameRate: 1 },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    })
    if (!loopWanted || gen !== loopGen) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) throw new Error('no loopback audio')
    loopStream = stream
    loopContext = new AudioContext()
    const source = loopContext.createMediaStreamSource(new MediaStream(audioTracks))
    loopProcessor = loopContext.createScriptProcessor(4096, 1, 1)
    loopGain = loopContext.createGain()
    loopGain.gain.value = 0
    loopProcessor.onaudioprocess = (event) => {
      const rate = loopContext?.sampleRate ?? 48000
      const raw = new Float32Array(event.inputBuffer.getChannelData(0))
      pcAudio.push(downsample(raw, rate, 16000), 16000)
    }
    source.connect(loopProcessor)
    loopProcessor.connect(loopGain)
    loopGain.connect(loopContext.destination)
    for (const track of audioTracks) {
      track.addEventListener('ended', () => {
        if (!loopWanted || gen !== loopGen) return
        if (loopRetries >= 2) {
          if (!loopNoted) {
            loopNoted = true
            window.voice.submitPcAudio('unavailable')
          }
          return
        }
        loopRetries += 1
        window.setTimeout(() => {
          if (loopWanted && gen === loopGen) void startLoopback()
        }, 1000)
      })
    }
    loopNoted = false
  } catch {
    if (!loopWanted || gen !== loopGen) return
    await closeLoopback()
    if (!loopNoted) {
      loopNoted = true
      window.voice.submitPcAudio('unavailable')
    }
  }
}

function takeLoopback(): void {
  const snap = pcAudio.snapshot()
  window.voice.submitLoopback(
    snap ? { sampleRate: snap.sampleRate, pcm: snap.samples } : { sampleRate: 16000, pcm: new Float32Array() }
  )
}

window.voice.onCommand((command) => {
  if (command.type === 'list') {
    void listDevices()
    return
  }
  if (command.type === 'start' || command.type === 'test') {
    purpose = command.type === 'test' ? 'test' : 'talk'
    const deviceId = command.deviceId
    void start(deviceId)
      .then(() => {
        if (command.type !== 'test') return
        window.setTimeout(() => {
          void teardown(true)
        }, command.ms || 3000)
      })
      .catch(() => window.voice.submitError('failed'))
    return
  }
  if (command.type === 'loopback-start') {
    loopRetries = 0
    void startLoopback()
    return
  }
  if (command.type === 'loopback-stop') {
    loopWanted = false
    void closeLoopback()
    return
  }
  if (command.type === 'loopback-take') {
    takeLoopback()
    return
  }
  void teardown(true)
})
