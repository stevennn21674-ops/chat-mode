import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'out')
if (!existsSync(root)) {
  console.error('Build output is missing. Run the build before scanning.')
  process.exit(1)
}

const needles = []
const key = (process.env.AGNES_API_KEY ?? '').trim()
if (key.length >= 8) needles.push(['credential', key])

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path, files)
    else if (stat.size < 20_000_000) files.push(path)
  }
  return files
}

const hits = []
for (const file of walk(root)) {
  let text = ''
  try {
    text = readFileSync(file)
  } catch {
    continue
  }
  const decoded = text.toString('utf8')
  for (const [label, needle] of needles) {
    if (needle && decoded.includes(needle)) hits.push(`${label} in ${file}`)
  }
}

if (hits.length) {
  console.error('Packaged output contains plaintext service details:')
  for (const hit of hits) console.error(`- ${hit.split(' in ')[0]}`)
  process.exit(1)
}

console.log('Bundle scan passed.')
