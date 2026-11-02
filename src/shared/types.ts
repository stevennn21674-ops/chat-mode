export type Badge = 'mod' | 'sub' | 'vip' | null
export type MessageKind = 'chat' | 'donation' | 'sub' | 'raid' | 'hype' | 'system'

export interface ChatMessage {
  id: string
  username: string
  badge: Badge
  color: string
  text: string
  kind: MessageKind
  amount?: string
  viewers?: number
  hypeLevel?: number
  hypeProgress?: number
  purgeUser?: string
}

export interface AppSettings {
  enabled: boolean
  screenReaction: boolean
  voiceEnabled: boolean
  hearComputerAudio: boolean
  micDeviceId: string
  speedLevel: number
  opacity: number
  fontSize: number
  x: number | null
  y: number | null
  width: number
  height: number
  proxyUrl: string
  proxyToken: string
  launchAtStartup: boolean
  capturePaused: boolean
  ecoMode: boolean
  captureIntervalSec: number
  maxCallsPerHour: number
  model: string
  baseUrl: string
  aiMode: boolean
  showDebugTranscript: boolean
  offlineMode: boolean
  overlayMode: 'normal' | 'game'
}

export interface OverlayState {
  speedLevel: number
  opacity: number
  fontSize: number
  analyzing: boolean
  micLive: boolean
  capturePaused: boolean
  speedFlash: number
  micNote: string | null
  viewerCount: number
  debugText: string | null
}

export interface MicDevice {
  deviceId: string
  label: string
}

export interface SettingsView extends AppSettings {
  serviceReady: boolean
  voiceModelReady: boolean
  hookReady: boolean
  analyzing: boolean
  micLive: boolean
  relayValid: boolean
  pauseHotkey: string
  talkKey: string
  apiKey: string
  includeKey: boolean
  hasUserKey: boolean
  hasFallbackKey: boolean
  keySource: 'user' | 'fallback' | 'none'
  encryptionAvailable: boolean
  callsThisHour: number
  onBattery: boolean
  idle: boolean
  keySaved?: boolean
  effectivelyOffline: boolean
}

export interface PointerEventPayload {
  type: 'down' | 'up'
  button: 'left' | 'right'
  mode: 'chat' | 'resize'
}

export const LIMITS = {
  speedMin: 1,
  speedMax: 7,
  opacityMin: 0.45,
  opacityMax: 1,
  fontMin: 12,
  fontMax: 22,
  widthMin: 280,
  widthMax: 560,
  heightMin: 360,
  heightMax: 1000,
  intervalMin: 15,
  intervalMax: 120,
  callsMin: 4,
  callsMax: 120
} as const

export const PAUSE_HOTKEY = 'Ctrl+Shift+F8'
export const TALK_KEY = 'V'
export const CAPTURE_KEY = '`'
