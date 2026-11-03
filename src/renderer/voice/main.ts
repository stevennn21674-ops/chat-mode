import { downsample, PcmWindow } from '@shared/audio'
import { describeMicFailure, micConstraints, vadStep } from '@shared/mic'
import type { MicDevice } from '@shared/types'

interface VoiceBridge {
  onCommand(
    callback: (
      command:
        | { type: 'start'; deviceId: string }
        | { type: 'stop' }
        | { type: 'test'; deviceId: string; ms: number; purpose?: 'test' | 'diagnose' }
        | { type: 'list' }
        | { type: 'arm'; deviceId: string; mode: 'vad' | 'off' }
        | { type: 'loopback-start' }
        | { type: 'loopback-stop' }
        | { type: 'loopback-take' }
    ) => void
  ): void
  submitAudio(payload: { sampleRate: number; pcm: Uint8Array; encoding: 'f32le'; purpose: 'talk' | 'test' | 'diagnose' }): void
  submitLevel(level: number): void
  submitDevices(devices: MicDevice[]): void
  submitError(payload: { code: 'denied' | 'missing' | 'failed' | 'empty' | 'silent'; detail: string; quiet?: boolean }): void
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
let purpose: 'talk' | 'test' | 'diagnose' = 'talk'
let levelAt = 0
let vadWanted = false
let vadDevice = ''
let vadSpeaking = false
let vadLoudMs = 0
let vadSilentMs = 0
let vadSpeechMs = 0
let preroll: Float32Array[] = []

const pcAudio = new PcmWindow(18)
let loopStream: MediaStream | null = null
let loopContext: AudioContext | null = null
let loopProcessor: ScriptProcessorNode | null = null
let loopGain: GainNode | null = null
let loopWanted = false
let loopNoted = false
let loopGen = 0
let loopRetries = 0

function sendPcm(samples: Float32Array, sampleRate: number, kind: 'talk' | 'test' | 'diagnose'): void {
  if (!samples.length) {
    const failure = describeMicFailure('empty', 'no sound from the microphone')
    window.voice.submitError({ code: failure.code, detail: failure.detail })
    window.voice.submitLevel(0)
    return
  }
  const bytes = new Uint8Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength))
  window.voice.submitAudio({ sampleRate, pcm: bytes, encoding: 'f32le', purpose: kind })
  window.voice.submitLevel(0)
}

function merge(parts: Float32Array[]): Float32Array {
  const length = parts.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Float32Array(length)
  let offset = 0
  for (const chunk of parts) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

async function teardown(send: boolean): Promise<void> {
  const rate = context?.sampleRate ?? 48000
  const kind = purpose
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
  vadSpeaking = false
  vadLoudMs = 0
  vadSilentMs = 0
  vadSpeechMs = 0
  preroll = []
  if (current) await current.close().catch(() => undefined)
  if (send) sendPcm(merge(recorded), rate, kind)
}

function reportMediaError(error: unknown): void {
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : ''
  const failure = describeMicFailure(name, message)
  window.voice.submitError({ code: failure.code, detail: failure.detail })
}

async function openMic(deviceId: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId) })
  } catch (error) {
    if (!deviceId) throw error
    return navigator.mediaDevices.getUserMedia({ audio: micConstraints('') })
  }
}

function rmsOf(data: Float32Array): number {
  let sum = 0
  let count = 0
  const step = Math.max(1, Math.floor(data.length / 200))
  for (let i = 0; i < data.length; i += step) {
    const sample = data[i] ?? 0
    sum += sample * sample
    count += 1
  }
  return count ? Math.sqrt(sum / count) : 0
}

async function attach(deviceId: string, vad: boolean): Promise<void> {
  await teardown(false)
  stream = await openMic(deviceId)
  const track = stream.getAudioTracks()[0]
  if (!track) throw new DOMException('no audio track', 'NotFoundError')
  context = new AudioContext()
  if (context.state !== 'running') await context.resume()
  if (context.state === 'suspended') throw new Error('audio context suspended')
  const source = context.createMediaStreamSource(stream)
  processor = context.createScriptProcessor(4096, 1, 1)
  gain = context.createGain()
  gain.gain.value = 0
  chunks = []
  levelAt = 0
  processor.onaudioprocess = (event) => {
    const data = event.inputBuffer.getChannelData(0)
    const copy = new Float32Array(data)
    const rate = context?.sampleRate ?? 48000
    const now = performance.now()
    if (now - levelAt >= 80) {
      levelAt = now
      window.voice.submitLevel(Math.max(0, Math.min(1, rmsOf(copy) * 4)))
    }
    if (!vad) {
      chunks.push(copy)
      return
    }
    const step = vadStep({
      rms: rmsOf(copy),
      speaking: vadSpeaking,
      loudMs: vadLoudMs,
      silentMs: vadSilentMs,
      frameMs: (copy.length / rate) * 1000,
      speechMs: vadSpeechMs
    })
    if (!step.speaking && !vadSpeaking) {
      preroll.push(copy)
      const max = Math.ceil(rate * 0.4)
      let total = preroll.reduce((sum, chunk) => sum + chunk.length, 0)
      while (total > max && preroll.length > 1) {
        total -= preroll[0]?.length ?? 0
        preroll.shift()
      }
    } else {
      if (!vadSpeaking && step.speaking) chunks = preroll.splice(0, preroll.length)
      chunks.push(copy)
    }
    const ended = vadSpeaking && step.emit
    vadSpeaking = step.speaking
    vadLoudMs = step.loudMs
    vadSilentMs = step.silentMs
    vadSpeechMs = step.speechMs
    if (ended) {
      const speech = merge(chunks)
      chunks = []
      preroll = []
      sendPcm(speech, rate, 'talk')
    }
  }
  source.connect(processor)
  processor.connect(gain)
  gain.connect(context.destination)
}

async function start(deviceId: string): Promise<void> {
  await attach(deviceId, false)
}

async function startVad(deviceId: string): Promise<void> {
  vadDevice = deviceId
  await attach(deviceId, true)
}

async function listDevices(): Promise<void> {
  try {
    const warmup = await navigator.mediaDevices.getUserMedia({ audio: micConstraints('') })
    warmup.getTracks().forEach((track) => track.stop())
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    const message = error instanceof Error ? error.message : ''
    const failure = describeMicFailure(name, message)
    window.voice.submitError({ code: failure.code, detail: failure.detail, quiet: true })
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
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 16, height: 16, frameRate: 1 },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    })
    if (!loopWanted || gen !== loopGen) {
      display.getTracks().forEach((track) => track.stop())
      return
    }
    const audioTracks = display.getAudioTracks()
    if (audioTracks.length === 0) throw new Error('no loopback audio')
    loopStream = display
    loopContext = new AudioContext()
    if (loopContext.state !== 'running') await loopContext.resume()
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

navigator.mediaDevices?.addEventListener('devicechange', () => {
  void listDevices()
})

window.voice.onCommand((command) => {
  if (command.type === 'list') {
    void listDevices()
    return
  }
  if (command.type === 'arm') {
    vadWanted = command.mode === 'vad'
    vadDevice = command.deviceId
    if (vadWanted) void startVad(command.deviceId).catch((error) => reportMediaError(error))
    else void teardown(false)
    return
  }
  if (command.type === 'start' || command.type === 'test') {
    purpose = command.type === 'test' ? command.purpose === 'diagnose' ? 'diagnose' : 'test' : 'talk'
    const deviceId = command.deviceId
    void start(deviceId)
      .then(() => {
        if (command.type !== 'test') return
        window.setTimeout(() => {
          void teardown(true)
        }, command.ms || 3000)
      })
      .catch((error) => reportMediaError(error))
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
  void teardown(true).finally(() => {
    if (vadWanted) void startVad(vadDevice).catch((error) => reportMediaError(error))
  })
})
