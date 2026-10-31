import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sealJson, unsealJson, type SealedBlob } from '../src/shared/seal'
import { completionsUrlFromBase, DEFAULT_BASE_URL, DEFAULT_MODEL } from '../src/shared/service-defaults'

describe('sealed credentials', () => {
  it('round-trips without leaving plaintext in the blob', () => {
    const secret = { apiKey: 'super-secret-key-value', model: 'hidden-model', endpoint: 'https://example.test/v1' }
    const blob = sealJson(secret)
    const serialized = JSON.stringify(blob)
    expect(serialized).not.toContain(secret.apiKey)
    expect(serialized).not.toContain(secret.model)
    expect(serialized).not.toContain('example.test')
    expect(unsealJson(blob)).toEqual(secret)
  })

  it('bakes from the environment without printing the key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatmode-seal-'))
    const out = join(dir, 'sealed.json')
    const key = 'unit-test-key-123456'
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/bake-secret.ts', '--out', out],
      {
        cwd: join(import.meta.dirname, '..'),
        env: { ...process.env, AGNES_API_KEY: key, REQUIRE_KEY: '1' },
        encoding: 'utf8'
      }
    )
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain(key)
    expect(result.stderr).not.toContain(key)
    expect(result.stdout).not.toContain(DEFAULT_MODEL)
    const blob = JSON.parse(readFileSync(out, 'utf8')) as SealedBlob
    expect(JSON.stringify(blob)).not.toContain(key)
    expect(unsealJson(blob)).toEqual({
      apiKey: key,
      model: DEFAULT_MODEL,
      endpoint: completionsUrlFromBase(DEFAULT_BASE_URL)
    })
  })

  it('still seals an empty fallback when no key is provided', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'chatmode-empty-')), 'sealed.json')
    const result = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/bake-secret.ts', '--out', out], {
      cwd: join(import.meta.dirname, '..'),
      env: { ...process.env, AGNES_API_KEY: '', REQUIRE_KEY: '' },
      encoding: 'utf8'
    })
    expect(result.status).toBe(0)
    const blob = JSON.parse(readFileSync(out, 'utf8')) as SealedBlob
    expect(unsealJson(blob)).toMatchObject({ apiKey: '' })
  })

  it('refuses a release bake when the key is missing', () => {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/bake-secret.ts', '--out', join(tmpdir(), 'unused.json')], {
      cwd: join(import.meta.dirname, '..'),
      env: { ...process.env, AGNES_API_KEY: '', REQUIRE_KEY: '1' },
      encoding: 'utf8'
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('AGNES_API_KEY')
  })
})
