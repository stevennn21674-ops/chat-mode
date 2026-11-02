export type Badge = 'mod' | 'sub' | 'vip' | null
export type BrainSpeed = 'light' | 'normal' | 'heavy'
export type BrainSize = 'small' | 'medium' | 'smart'
export type MessageKind = 'chat' | 'donation' | 'sub' | 'bits' | 'gift' | 'raid' | 'hype' | 'system'
export type AlertFrequency = 'rare' | 'normal' | 'often'
export type SoundPack = 'coin' | 'chime' | 'arcade' | 'horn'
export type ChatMix = 'real' | 'mixed'

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
  localBrain: boolean
  brainSpeed: BrainSpeed
  brainSize: BrainSize
  lockPosition: boolean
  alertsEnabled: boolean
  alertVolume: number
  alertFrequency: AlertFrequency
  alertMin: number
  alertMax: number
  alertCurrency: string
  alertSound: SoundPack
  alertTts: boolean
  twitchChannel: string
  youtubeLive: string
  chatMix: ChatMix
  hideBadWords: boolean
  liveLink: boolean
  screenWatch: boolean
  autoVision: boolean
  autoVisionPerHour: number
  pauseWatchOnBattery: boolean
}

export interface AlertBanner {
  kind: MessageKind
  username: string
  amount: string
  text: string
  sound: SoundPack
  volume: number
  speak: string | null
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
  localBrainReady: boolean
  localBrainDownloading: boolean
  localBrainDeletable: boolean
  localBrainProgress: number | null
  localBrainNote: string
  localBrainButton: string
  youtubeApiKey: string
  hasYoutubeKey: boolean
  liveStatus: string
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
  callsMax: 120,
  alertMin: 1,
  alertMax: 500,
  autoVisionMin: 1,
  autoVisionMax: 12
} as const

export const PAUSE_HOTKEY = 'Ctrl+Shift+F8'
export const TALK_KEY = 'V'
export const CAPTURE_KEY = '`'
