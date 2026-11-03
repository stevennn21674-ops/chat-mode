import type { MicDevice } from './types'

export const OVERLAY_AUDIO_ERROR = 'Audio error'
export const MIC_PRIVACY_FIX = 'Windows Settings > Privacy > Microphone, allow desktop apps.'
export const MIC_SILENT = 'mic is silent: check your mic or pick another in Settings'
export const VAD_RMS = 0.012
export const VAD_LOUD_MS = 280
export const VAD_SILENT_MS = 700
export const VAD_MAX_MS = 12_000

export type TalkMode = 'hold' | 'toggle' | 'vad'
export type MicErrorCode = 'denied' | 'missing' | 'failed' | 'empty' | 'silent'

export interface MicStage {
  id: 'permission' | 'device' | 'level' | 'hook' | 'transcription'
  label: string
  pass: boolean
  detail: string
}

const VIRTUAL = /stereo mix|loopback|virtual|cable|vb-audio|voicemeeter|blackhole|soundflower|what u hear|wave out|monitor of|\bobs\b|oculus|nvidia broadcast/i

export function normalizeTalkKey(value: string): string {
  const letter = value.trim().slice(0, 1).toUpperCase()
  return /^[A-Z]$/.test(letter) ? letter : 'V'
}

export function isVirtualInput(label: string): boolean {
  return VIRTUAL.test(label)
}

export function chooseMicrophone(devices: MicDevice[], saved: string): string {
  const real = devices.filter(
    (device) =>
      device.deviceId &&
      device.deviceId !== 'default' &&
      device.deviceId !== 'communications' &&
      !isVirtualInput(device.label)
  )
  if (saved && devices.some((device) => device.deviceId === saved)) return saved
  const labeledDefault = devices.find((device) => device.deviceId === 'default' || /^default\b/i.test(device.label))
  const fallback = real[0]
  if (labeledDefault && isVirtualInput(labeledDefault.label) && fallback) return fallback.deviceId
  if (saved && fallback) return fallback.deviceId
  return ''
}

export function micConstraints(deviceId: string): {
  channelCount: { ideal: number }
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
  deviceId?: { ideal: string }
} {
  const audio = {
    channelCount: { ideal: 1 },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: true
  }
  if (!deviceId) return audio
  return { ...audio, deviceId: { ideal: deviceId } }
}

export function describeMicFailure(name: string, message = ''): { code: MicErrorCode; detail: string } {
  const blob = `${name} ${message}`
  if (/NotAllowed|PermissionDenied|SecurityError|denied|not allowed/i.test(blob)) {
    return { code: 'denied', detail: `Microphone permission denied (${name || 'NotAllowedError'}). ${MIC_PRIVACY_FIX}` }
  }
  if (/NotFound|DevicesNotFound|Overconstrained/i.test(blob)) {
    return { code: 'missing', detail: `No microphone was found (${name || 'NotFoundError'}). Pick another device in Settings. ${MIC_PRIVACY_FIX}` }
  }
  if (/silent/i.test(blob)) return { code: 'silent', detail: MIC_SILENT }
  if (/empty|too short/i.test(blob)) return { code: 'empty', detail: message || 'The recording was empty.' }
  return {
    code: 'failed',
    detail: `Microphone failed to open (${name || 'Error'}${message ? `: ${message}` : ''}). ${MIC_PRIVACY_FIX}`
  }
}

export function hookTalkAction(input: { repeat: boolean; down: boolean; mode: TalkMode; held: boolean }): 'down' | 'up' | 'ignore' {
  if (input.mode === 'vad') return 'ignore'
  if (input.repeat) return 'ignore'
  if (input.down) {
    if (input.mode === 'toggle') return input.held ? 'up' : 'down'
    if (input.held) return 'ignore'
    return 'down'
  }
  if (input.mode === 'hold' && input.held) return 'up'
  return 'ignore'
}

export function vadStep(input: {
  rms: number
  speaking: boolean
  loudMs: number
  silentMs: number
  frameMs: number
  speechMs: number
}): { speaking: boolean; loudMs: number; silentMs: number; speechMs: number; emit: boolean } {
  const frame = Math.max(0, input.frameMs)
  const loud = input.rms >= VAD_RMS
  if (!input.speaking) {
    const loudMs = loud ? input.loudMs + frame : 0
    if (loudMs >= VAD_LOUD_MS) return { speaking: true, loudMs, silentMs: 0, speechMs: loudMs, emit: false }
    return { speaking: false, loudMs, silentMs: 0, speechMs: 0, emit: false }
  }
  const silentMs = loud ? 0 : input.silentMs + frame
  const speechMs = input.speechMs + frame
  if (silentMs >= VAD_SILENT_MS || speechMs >= VAD_MAX_MS) {
    return { speaking: false, loudMs: 0, silentMs: 0, speechMs: 0, emit: true }
  }
  return { speaking: true, loudMs: input.loudMs, silentMs, speechMs, emit: false }
}

export function micStages(input: {
  access: string
  openError: string | null
  deviceLabel: string
  deviceCount: number
  savedVirtual: boolean
  peakRms: number | null
  hookReady: boolean
  modelReady: boolean
  transcript: string
  transcriptError: string | null
}): MicStage[] {
  const permissionOk = input.access !== 'denied' && input.access !== 'restricted' && !input.openError
  const deviceOk = input.deviceCount > 0 && !input.savedVirtual
  const levelOk = input.openError === null && input.peakRms !== null && input.peakRms >= 0.004
  const speechOk = permissionOk && levelOk && input.modelReady && Boolean(input.transcript) && !input.transcriptError
  const permissionDetail = permissionOk
    ? `Microphone access: ${input.access || 'granted'}.`
    : input.openError || `Microphone access: ${input.access}. ${MIC_PRIVACY_FIX}`
  const deviceDetail = !input.deviceCount
    ? 'No input device was found.'
    : input.savedVirtual
      ? `This looks like a virtual input (${input.deviceLabel}). Pick a real microphone in Settings.`
      : input.deviceLabel || 'System default'
  const levelDetail = input.openError
    ? input.openError
    : levelOk
      ? `Peak level ${input.peakRms?.toFixed(3)}.`
      : MIC_SILENT
  const speechDetail = speechOk
    ? `heard: ${input.transcript}`
    : input.transcriptError || (input.modelReady ? 'Nothing was recognized.' : 'Speech model is not installed.')
  return [
    { id: 'permission', label: 'Permission', pass: permissionOk, detail: permissionDetail },
    { id: 'device', label: 'Device', pass: deviceOk, detail: deviceDetail },
    { id: 'level', label: 'Level', pass: levelOk, detail: levelDetail },
    {
      id: 'hook',
      label: 'Hook',
      pass: input.hookReady,
      detail: input.hookReady
        ? 'Global key hook is running, including while another app is focused.'
        : 'Global hook is unavailable. The fallback hotkey is Alt plus your talk key.'
    },
    { id: 'transcription', label: 'Transcription', pass: speechOk, detail: speechDetail }
  ]
}
