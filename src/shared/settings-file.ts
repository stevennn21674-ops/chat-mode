import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppSettings } from './types'
import { serializeSettings, settingsFromUnknown } from './settings'

export function readSettingsFile(file: string): AppSettings {
  try {
    const raw = readFileSync(file, 'utf8')
    return settingsFromUnknown(JSON.parse(raw) as unknown)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return settingsFromUnknown(null)
    try {
      renameSync(file, `${file}.corrupt`)
    } catch {
      // The unreadable file can stay where it is. Defaults still load.
    }
    return settingsFromUnknown(null)
  }
}

export function writeSettingsFile(file: string, settings: AppSettings): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, serializeSettings(settings), { mode: 0o600 })
  renameSync(tmp, file)
}
