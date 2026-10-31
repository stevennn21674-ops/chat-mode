import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLimiter } from '../proxy/rate-limit.mjs'

const root = join(import.meta.dirname, '..')

function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'out' || name === 'release' || name === 'generated' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, found)
    else if (/\.(ts|tsx|js|mjs|css|html|md|yml|json)$/.test(name)) found.push(path)
  }
  return found
}

function text(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('source hygiene', () => {
  it('does not hard-code a user API key in the app', () => {
    for (const file of [...files(join(root, 'src')), join(root, 'README.md'), join(root, 'docs/SECURITY.md')]) {
      const body = text(file)
      expect(body, file).not.toMatch(/apiKey:\s*['"][^'"]{8,}['"]/)
      expect(body, file).not.toMatch(/\bsk-[A-Za-z0-9]{12,}\b/)
    }
  })

  it('does not hard-code a relay credential', () => {
    const server = text(join(root, 'proxy/server.mjs'))
    const worker = text(join(root, 'proxy/worker.js'))
    expect(server).toContain('process.env.AGNES_API_KEY')
    expect(worker).toContain('env.AGNES_API_KEY')
    expect(server).not.toMatch(/sk-[A-Za-z0-9]{8,}/)
    expect(worker).not.toMatch(/sk-[A-Za-z0-9]{8,}/)
  })
})

describe('relay rate limit', () => {
  it('blocks a client after the window fills', () => {
    const limiter = createLimiter({ limit: 2, windowMs: 1000 })
    expect(limiter.allow('1.1.1.1', 0)).toBe(true)
    expect(limiter.allow('1.1.1.1', 10)).toBe(true)
    expect(limiter.allow('1.1.1.1', 20)).toBe(false)
    expect(limiter.allow('1.1.1.1', 2000)).toBe(true)
  })
})
