import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { emptyUsage, pruneUsage, type CallUsage } from '../shared/budget'

export class UsageStore {
  usage: CallUsage = emptyUsage()

  constructor(private file: string) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { timestamps?: unknown }
      if (Array.isArray(parsed.timestamps)) {
        this.usage = pruneUsage({
          timestamps: parsed.timestamps.filter((stamp): stamp is number => typeof stamp === 'number' && Number.isFinite(stamp))
        }, Date.now())
      }
    } catch {
      this.usage = emptyUsage()
    }
  }

  replace(usage: CallUsage): void {
    this.usage = usage
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.usage), { mode: 0o600 })
  }
}
