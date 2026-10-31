import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export class CredentialStore {
  private cached: string | null = null

  constructor(private file: string) {}

  encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  get(): string {
    if (this.cached !== null) return this.cached
    try {
      if (!existsSync(this.file) || !this.encryptionAvailable()) {
        this.cached = ''
        return ''
      }
      this.cached = safeStorage.decryptString(readFileSync(this.file)).trim()
      return this.cached
    } catch {
      this.cached = ''
      return ''
    }
  }

  set(key: string): boolean {
    const trimmed = key.replace(/[\r\n]/g, '').trim()
    if (!trimmed) {
      this.cached = ''
      try {
        unlinkSync(this.file)
      } catch {
        // Nothing was stored.
      }
      return true
    }
    if (!this.encryptionAvailable()) return false
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, safeStorage.encryptString(trimmed), { mode: 0o600 })
    this.cached = trimmed
    return true
  }
}
