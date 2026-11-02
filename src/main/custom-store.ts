import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { emptyCrowd, sanitizeCrowd, type CustomCrowd } from '../shared/custom-viewers'

export class CustomStore {
  crowd: CustomCrowd

  constructor(private file: string) {
    this.crowd = this.load()
  }

  replace(value: unknown): CustomCrowd {
    this.crowd = sanitizeCrowd(value)
    this.save()
    return this.crowd
  }

  serialize(): string {
    return JSON.stringify(this.crowd, null, 2)
  }

  private load(): CustomCrowd {
    try {
      return sanitizeCrowd(JSON.parse(readFileSync(this.file, 'utf8')) as unknown)
    } catch {
      return emptyCrowd()
    }
  }

  private save(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, this.serialize())
    renameSync(tmp, this.file)
  }
}
