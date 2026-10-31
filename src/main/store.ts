import { applyPatch } from '../shared/settings'
import type { AppSettings } from '../shared/types'
import { writeSettingsFile } from '../shared/settings-file'

export class SettingsStore {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private file: string,
    public settings: AppSettings
  ) {}

  update(patch: unknown): AppSettings {
    this.settings = applyPatch(this.settings, patch)
    this.schedule()
    return this.settings
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    writeSettingsFile(this.file, this.settings)
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      writeSettingsFile(this.file, this.settings)
    }, 150)
  }
}
