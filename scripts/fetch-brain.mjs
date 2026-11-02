import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(readFileSync(join(root, 'src/shared/brain-models.json'), 'utf8'))
const dest = join(root, 'resources/brain')

function sha256(file) {
  const hash = createHash('sha256')
  const bytes = readFileSync(file)
  hash.update(bytes)
  return hash.digest('hex')
}

function sha256Stream(file) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

async function download(url, file, retry = true) {
  mkdirSync(dirname(file), { recursive: true })
  const partial = `${file}.partial`
  let existing = 0
  try {
    existing = statSync(partial).size
  } catch {
    existing = 0
  }
  const headers = { 'User-Agent': 'ChatMode-build' }
  if (existing > 0) headers.Range = `bytes=${existing}-`
  const response = await fetch(url, { headers, redirect: 'follow' })
  if (response.status === 416 && retry) {
    rmSync(partial, { force: true })
    return download(url, file, false)
  }
  if (!response.ok && response.status !== 206) {
    throw new Error(`Download failed (${response.status}) for ${url}`)
  }
  const append = response.status === 206 && existing > 0
  if (!append) existing = 0
  if (!response.body) throw new Error(`Empty download for ${url}`)
  const totalHeader = Number(response.headers.get('content-length') || 0)
  const total = append ? existing + totalHeader : totalHeader
  let got = existing
  let mark = 0
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      got += chunk.length
      if (total > 0) {
        const percent = Math.floor((got / total) * 10)
        if (percent > mark) {
          mark = percent
          console.log(`  ${percent * 10}%`)
        }
      }
      callback(null, chunk)
    }
  })
  await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partial, { flags: append ? 'a' : 'w' }))
  renameSync(partial, file)
}

function walk(dir, found = []) {
  if (!existsSync(dir)) return found
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, found)
    else found.push(path)
  }
  return found
}

function wanted(name) {
  const base = name.split(/[/\\]/).pop()?.toLowerCase() ?? ''
  return base === 'llama-server.exe' || base.endsWith('.dll') || base.startsWith('license')
}

async function installRuntime() {
  const runtime = catalog.runtime.win32
  const bin = join(dest, 'bin')
  const exe = join(bin, 'llama-server.exe')
  const stamp = join(bin, `runtime-${catalog.runtime.version}.txt`)
  if (existsSync(exe) && existsSync(stamp) && existsSync(join(bin, 'llama-server-impl.dll'))) {
    console.log(`llama.cpp ${catalog.runtime.version} runtime already present.`)
    return
  }
  mkdirSync(bin, { recursive: true })
  const scratch = join(tmpdir(), `chatmode-brain-${Date.now()}`)
  mkdirSync(scratch, { recursive: true })
  const archive = join(scratch, 'llama.zip')
  console.log(`Downloading llama.cpp ${catalog.runtime.version} for Windows...`)
  await download(runtime.url, archive)
  const digest = sha256(archive)
  if (digest !== runtime.sha256) throw new Error(`Runtime archive hash mismatch: ${digest}`)
  const extracted = join(scratch, 'extract')
  mkdirSync(extracted, { recursive: true })
  const tar = spawnSync('tar', ['-xf', archive, '-C', extracted], { stdio: 'inherit' })
  if (tar.status !== 0) throw new Error('Could not extract the llama.cpp archive')
  for (const file of walk(extracted)) {
    if (!wanted(file)) continue
    const base = file.split(/[/\\]/).pop()
    if (!base) continue
    copyFileSync(file, join(bin, base))
  }
  if (!existsSync(exe) || !existsSync(join(bin, 'llama-server-impl.dll'))) {
    throw new Error('llama-server.exe was not in the runtime archive')
  }
  writeFileSync(stamp, catalog.runtime.version)
  rmSync(scratch, { recursive: true, force: true })
  console.log(`Runtime unpacked to ${bin}`)
}

async function installModels() {
  mkdirSync(join(dest, 'models'), { recursive: true })
  for (const spec of Object.values(catalog.models)) {
    if (!spec.bundled) continue
    const file = join(dest, 'models', spec.file)
    if (existsSync(file) && statSync(file).size === spec.bytes && (await sha256Stream(file)) === spec.sha256) {
      console.log(`Bundled model already present (${spec.bytes} bytes): ${spec.file}`)
      continue
    }
    console.log(`Downloading ${spec.family} ${spec.quant} (${spec.bytes} bytes)...`)
    rmSync(file, { force: true })
    await download(spec.url, file)
    const size = statSync(file).size
    const digest = await sha256Stream(file)
    if (size !== spec.bytes || digest !== spec.sha256) {
      rmSync(file, { force: true })
      throw new Error(`Model check failed for ${spec.file} (${size} bytes, ${digest})`)
    }
    console.log(`Saved ${spec.file} (${size} bytes)`)
  }
}

const platform = process.argv[2] || process.platform
if (platform === 'win32') await installRuntime()
else console.log('Skipping the Windows llama.cpp runtime on this platform.')
await installModels()
console.log('Local brain files are ready.')
