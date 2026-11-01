import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const main = readFileSync(join(import.meta.dirname, '../src/main/index.ts'), 'utf8')

describe('main startup order', () => {
  it('initializes captureHintUntil before the tray reads status', () => {
    const declared = main.search(/\blet captureHintUntil\s*=/)
    const tray = main.indexOf('createTray(')
    expect(declared).toBeGreaterThanOrEqual(0)
    expect(tray).toBeGreaterThan(declared)
  })
})
