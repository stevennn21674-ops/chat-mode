import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function credentialsFile(): string {
  return join(app.getPath('userData'), 'credentials.bin')
}

export function youtubeKeyFile(): string {
  return join(app.getPath('userData'), 'youtube-key.bin')
}

export function usageFile(): string {
  return join(app.getPath('userData'), 'usage.json')
}

export function voiceDebugFile(): string {
  return join(app.getPath('userData'), 'voice-debug.log')
}

export function customViewersFile(): string {
  return join(app.getPath('userData'), 'custom-viewers.json')
}

export function wikiCacheFile(): string {
  return join(app.getPath('userData'), 'wiki-cache.json')
}

export function resourceDir(...parts: string[]): string {
  if (app.isPackaged) return join(process.resourcesPath, ...parts)
  return join(app.getAppPath(), 'resources', ...parts)
}

export function whisperLocation(): { bin: string; model: string } | null {
  const dir = resourceDir('whisper')
  const bin = join(dir, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli')
  const model = join(dir, 'ggml-tiny.en.bin')
  if (!existsSync(bin) || !existsSync(model)) return null
  return { bin, model }
}
