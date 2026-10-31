import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dest = resolve(root, 'resources/whisper')
const release = 'b5454'
const modelName = 'ggml-tiny.en.bin'
const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`
const modelSha1 = 'c78c86eb1a8faa21b369bcd33207cc90d64ae9df'

const archives = {
  win32: `https://github.com/ggml-org/whisper.cpp/releases/download/${release}/whisper-bin-x64.zip`,
  linux: `https://github.com/ggml-org/whisper.cpp/releases/download/${release}/whisper-bin-ubuntu-x64.tar.gz`
}

function platformOf(arg) {
  if (arg === 'win32' || arg === 'linux' || arg === 'darwin') return arg
  return process.platform
}

async function download(url, file) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  writeFileSync(file, bytes)
  return bytes
}

function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path, found)
    else found.push(path)
  }
  return found
}

function wanted(name, platform) {
  const base = name.toLowerCase()
  if (platform === 'win32') {
    return (
      base === 'whisper-cli.exe' ||
      base === 'whisper.dll' ||
      base === 'ggml.dll' ||
      base === 'ggml-base.dll' ||
      base.startsWith('ggml-cpu-')
    )
  }
  return base === 'whisper-cli' || base.startsWith('libggml') || base.startsWith('libwhisper') || base.endsWith('.so') || base.endsWith('.dylib')
}

const platform = platformOf(process.argv[2])
const archiveUrl = archives[platform]
if (!archiveUrl) {
  console.error(`No speech binary is configured for ${platform}.`)
  process.exit(1)
}

mkdirSync(dest, { recursive: true })
const cliName = platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
const scratch = join(tmpdir(), `chatmode-whisper-${Date.now()}`)

try {
  if (existsSync(join(dest, cliName))) {
    console.log('Speech binary already present.')
  } else {
    mkdirSync(scratch, { recursive: true })
    const archivePath = join(scratch, platform === 'win32' ? 'whisper.zip' : 'whisper.tar.gz')
    console.log(`Downloading speech binary for ${platform}...`)
    await download(archiveUrl, archivePath)
    const extracted = join(scratch, 'extract')
    mkdirSync(extracted, { recursive: true })
    const tar = spawnSync('tar', ['-xf', archivePath, '-C', extracted], { stdio: 'inherit' })
    if (tar.status !== 0) throw new Error('Could not extract the speech binary archive')

    const files = walk(extracted)
    const cli = files.find((file) => file.endsWith(cliName) || file.endsWith(`/${cliName}`))
    if (!cli) throw new Error(`Did not find ${cliName} in the archive`)
    const binDir = dirname(cli)
    for (const file of readdirSync(binDir)) {
      if (!wanted(file, platform)) continue
      copyFileSync(join(binDir, file), join(dest, file))
    }
  }

  const modelPath = join(dest, modelName)
  const current = existsSync(modelPath) ? readFileSync(modelPath) : null
  const currentSha = current ? createHash('sha1').update(current).digest('hex') : ''
  if (currentSha !== modelSha1) {
    console.log('Downloading the tiny English speech model...')
    const model = await download(modelUrl, modelPath)
    const sha = createHash('sha1').update(model).digest('hex')
    if (sha !== modelSha1) throw new Error('Speech model checksum did not match')
  } else {
    console.log('Speech model already present.')
  }
  console.log(`Speech files are in ${dest}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
