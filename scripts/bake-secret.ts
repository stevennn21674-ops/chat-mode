import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sealJson } from '../src/shared/seal.ts'
import { completionsUrlFromBase, DEFAULT_BASE_URL, DEFAULT_MODEL } from '../src/shared/service-defaults.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv(file: string): void {
  if (!existsSync(file)) return
  const text = readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function outputPath(): string {
  const index = process.argv.indexOf('--out')
  if (index >= 0 && process.argv[index + 1]) return resolve(process.argv[index + 1])
  return resolve(repoRoot, 'src/main/generated/sealed-secret.json')
}

loadEnv(resolve(repoRoot, '.env'))

const apiKey = (process.env.AGNES_API_KEY ?? '').trim()
if (!apiKey && process.env.REQUIRE_KEY === '1') {
  console.error('AGNES_API_KEY is not set. Add the GitHub Actions secret, or put it in .env for local development.')
  process.exit(1)
}

const sealed = sealJson({
  apiKey,
  model: DEFAULT_MODEL,
  endpoint: completionsUrlFromBase(DEFAULT_BASE_URL)
})
const out = outputPath()
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(sealed))
console.log(
  apiKey
    ? 'Sealed service credentials.'
    : 'Sealed config without a key. Offline chat will be used until a key is provided at build time.'
)
