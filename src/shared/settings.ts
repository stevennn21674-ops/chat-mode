import { DEFAULT_BASE_URL, DEFAULT_MODEL } from './service-defaults'
import { LIMITS, type AppSettings } from './types'

export const DEFAULT_SETTINGS: AppSettings = {
  enabled: true,
  screenReaction: true,
  voiceEnabled: true,
  hearComputerAudio: true,
  micDeviceId: '',
  speedLevel: 4,
  opacity: 0.92,
  fontSize: 15,
  x: null,
  y: null,
  width: 360,
  height: 640,
  proxyUrl: '',
  proxyToken: '',
  launchAtStartup: false,
  capturePaused: false,
  ecoMode: true,
  captureIntervalSec: 25,
  maxCallsPerHour: 20,
  model: DEFAULT_MODEL,
  baseUrl: DEFAULT_BASE_URL,
  aiMode: false,
  showDebugTranscript: false,
  offlineMode: false,
  overlayMode: 'normal'
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function usableProxyUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return trimmed.replace(/\/$/, '')
  } catch {
    return ''
  }
}

export function aiModeSpecified(value: unknown): boolean | null {
  if (!value || typeof value !== 'object') return null
  const flag = (value as Record<string, unknown>).aiMode
  return typeof flag === 'boolean' ? flag : null
}

export function defaultAiMode(hasApiKey: boolean, specified: boolean | null): boolean {
  if (specified !== null) return specified
  return hasApiKey
}

export function chatUsesService(aiMode: boolean, demo = false): boolean {
  return aiMode || demo
}

export function canReachService(
  settings: { proxyUrl: string },
  config: { apiKey: string; model: string; endpoint: string }
): boolean {
  if (usableProxyUrl(settings.proxyUrl)) return true
  return Boolean(config.apiKey && config.model && config.endpoint)
}

export function applyPatch(current: AppSettings, patch: unknown): AppSettings {
  const next: AppSettings = { ...current }
  if (!patch || typeof patch !== 'object') return next
  const raw = patch as Record<string, unknown>

  if (typeof raw.enabled === 'boolean') next.enabled = raw.enabled
  if (typeof raw.screenReaction === 'boolean') next.screenReaction = raw.screenReaction
  if (typeof raw.voiceEnabled === 'boolean') next.voiceEnabled = raw.voiceEnabled
  if (typeof raw.hearComputerAudio === 'boolean') next.hearComputerAudio = raw.hearComputerAudio
  if (typeof raw.launchAtStartup === 'boolean') next.launchAtStartup = raw.launchAtStartup
  if (typeof raw.capturePaused === 'boolean') next.capturePaused = raw.capturePaused

  if (typeof raw.micDeviceId === 'string') next.micDeviceId = raw.micDeviceId.slice(0, 200)

  const speed = finiteNumber(raw.speedLevel)
  if (speed !== null) next.speedLevel = clamp(Math.round(speed), LIMITS.speedMin, LIMITS.speedMax)

  const opacity = finiteNumber(raw.opacity)
  if (opacity !== null) next.opacity = clamp(opacity, LIMITS.opacityMin, LIMITS.opacityMax)

  const fontSize = finiteNumber(raw.fontSize)
  if (fontSize !== null) next.fontSize = clamp(Math.round(fontSize), LIMITS.fontMin, LIMITS.fontMax)

  if (raw.x === null) next.x = null
  else {
    const x = finiteNumber(raw.x)
    if (x !== null) next.x = Math.round(x)
  }
  if (raw.y === null) next.y = null
  else {
    const y = finiteNumber(raw.y)
    if (y !== null) next.y = Math.round(y)
  }

  const width = finiteNumber(raw.width)
  if (width !== null) next.width = clamp(Math.round(width), LIMITS.widthMin, LIMITS.widthMax)
  const height = finiteNumber(raw.height)
  if (height !== null) next.height = clamp(Math.round(height), LIMITS.heightMin, LIMITS.heightMax)

  if (typeof raw.proxyUrl === 'string') next.proxyUrl = raw.proxyUrl.trim().slice(0, 400)
  if (typeof raw.proxyToken === 'string') next.proxyToken = raw.proxyToken.replace(/[\r\n]/g, '').slice(0, 200)

  if (typeof raw.ecoMode === 'boolean') next.ecoMode = raw.ecoMode
  if (typeof raw.aiMode === 'boolean') next.aiMode = raw.aiMode
  if (typeof raw.showDebugTranscript === 'boolean') next.showDebugTranscript = raw.showDebugTranscript
  if (typeof raw.offlineMode === 'boolean') next.offlineMode = raw.offlineMode
  if (raw.overlayMode === 'normal' || raw.overlayMode === 'game') next.overlayMode = raw.overlayMode
  const interval = finiteNumber(raw.captureIntervalSec)
  if (interval !== null) {
    next.captureIntervalSec = clamp(Math.round(interval), LIMITS.intervalMin, LIMITS.intervalMax)
  }
  const calls = finiteNumber(raw.maxCallsPerHour)
  if (calls !== null) next.maxCallsPerHour = clamp(Math.round(calls), LIMITS.callsMin, LIMITS.callsMax)
  if (typeof raw.model === 'string') {
    const model = raw.model.trim().slice(0, 80)
    if (model) next.model = model
  }
  if (typeof raw.baseUrl === 'string') {
    const base = raw.baseUrl.trim().slice(0, 300)
    next.baseUrl = base || DEFAULT_BASE_URL
  }

  return next
}

export function settingsFromUnknown(value: unknown): AppSettings {
  return applyPatch(DEFAULT_SETTINGS, value)
}

export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify(settings, null, 2)
}
