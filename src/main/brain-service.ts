import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs'
import { cpus, setPriority } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  brainPanel,
  buildBrainPrompt,
  chooseModel,
  clampThreads,
  cpuPercent,
  enoughDisk,
  formatBytes,
  messagesFromBrain,
  modelSpec,
  paceFor,
  readCpuTimes,
  resumeHeader,
  type BrainPanel,
  type BrainTurn,
  type ModelChoice,
  type ModelPresence
} from '../shared/brain'
import { extractAssistantText } from '../shared/response'
import type { AppSettings, BrainSize, ChatMessage } from '../shared/types'

interface BrainOptions {
  userDataDir: string
  resourceDir: string
  log: (line: string) => void
  getSettings: () => AppSettings
  notify: () => void
}

const SIZES: BrainSize[] = ['small', 'medium']

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cpuCount(): number {
  const count = cpus().length
  return count > 0 ? count : 2
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

export class BrainService {
  private proc: ChildProcess | null = null
  private exited = false
  private port = 39221
  private generation = 0
  private loadedPath = ''
  private loadedThreads = 0
  private queue: Promise<void> = Promise.resolve()
  private downloading = false
  private progress: number | null = null
  private flash = ''
  private abort: AbortController | null = null
  private lastNotify = 0
  private cpuPrev = readCpuTimes()
  private cpuValue: number | null = null
  private cpuTimer: NodeJS.Timeout | null = null
  private schema = true

  constructor(private opts: BrainOptions) {}

  startSampler(): void {
    if (this.cpuTimer) return
    this.cpuPrev = readCpuTimes()
    this.cpuTimer = setInterval(() => {
      const next = readCpuTimes()
      this.cpuValue = cpuPercent(this.cpuPrev, next)
      this.cpuPrev = next
    }, 2000)
    this.cpuTimer.unref()
  }

  stopSampler(): void {
    if (!this.cpuTimer) return
    clearInterval(this.cpuTimer)
    this.cpuTimer = null
  }

  cpu(): number | null {
    return this.cpuValue
  }

  ready(): boolean {
    return Boolean(this.binaryPath() && this.choice())
  }

  selectedOnDisk(): boolean {
    const choice = this.choice()
    return Boolean(choice && choice.size === this.opts.getSettings().brainSize && !choice.fallback)
  }

  panel(): BrainPanel {
    const settings = this.opts.getSettings()
    return brainPanel({
      selected: settings.brainSize,
      runtime: Boolean(this.binaryPath()),
      choice: chooseModel(settings.brainSize, this.presence()),
      downloading: this.downloading,
      progress: this.progress,
      deletable: this.deletable(),
      flash: this.flash
    })
  }

  onSettings(): void {
    const settings = this.opts.getSettings()
    if (settings.aiMode || !settings.localBrain) {
      this.stop()
      return
    }
    const choice = this.choice()
    const threads = clampThreads(paceFor(settings.brainSpeed).threads, cpuCount())
    if (!choice || (this.proc && (choice.path !== this.loadedPath || threads !== this.loadedThreads))) this.stop()
  }

  generate(turn: BrainTurn): Promise<ChatMessage[] | null> {
    const run = this.queue.then(() => this.generateOnce(turn))
    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async download(size: BrainSize): Promise<{ ok: boolean; detail: string }> {
    if (this.downloading) return { ok: false, detail: 'A download is already running.' }
    const spec = modelSpec(size)
    const dir = join(this.opts.userDataDir, 'brain', 'models')
    mkdirSync(dir, { recursive: true })
    let free = spec.bytes + 201 * 1024 * 1024
    try {
      const space = statfsSync(dir)
      free = Number(space.bavail) * Number(space.bsize)
    } catch {
      free = spec.bytes + 201 * 1024 * 1024
    }
    if (!enoughDisk(free, spec.bytes)) {
      const detail = `Not enough free disk space. The ${spec.label.toLowerCase()} model needs ${formatBytes(spec.bytes)} plus a little spare room.`
      this.flash = detail
      this.push(true)
      return { ok: false, detail }
    }
    this.downloading = true
    this.progress = 0
    this.flash = ''
    this.abort = new AbortController()
    this.push(true)
    const dest = join(dir, spec.file)
    const partial = `${dest}.partial`
    try {
      await this.streamModel(spec.url, spec.bytes, partial, this.abort.signal)
      const digest = await hashFile(partial)
      if (digest !== spec.sha256) {
        rmSync(partial, { force: true })
        const detail = 'The download did not match the expected model, so it was discarded.'
        this.flash = detail
        return { ok: false, detail }
      }
      rmSync(dest, { force: true })
      renameSync(partial, dest)
      this.unremove(spec.file)
      this.stop()
      const detail = `${spec.label} model saved on this PC (${formatBytes(spec.bytes)}). Local brain can use it offline.`
      this.flash = detail
      return { ok: true, detail }
    } catch {
      const cancelled = this.abort?.signal.aborted
      const detail = cancelled ? 'Download cancelled.' : 'The download failed. It can be resumed from Settings.'
      if (!cancelled) this.opts.log('local brain download failed')
      this.flash = detail
      return { ok: false, detail }
    } finally {
      this.downloading = false
      this.progress = null
      this.abort = null
      this.push(true)
    }
  }

  deleteModels(): string {
    this.abort?.abort()
    this.stop()
    const removed = new Set(this.readRemoved())
    let stuck = false
    for (const size of SIZES) {
      const spec = modelSpec(size)
      removed.add(spec.file)
      for (const path of [this.downloadPath(spec.file), `${this.downloadPath(spec.file)}.partial`, this.bundlePath(spec.file)]) {
        try {
          rmSync(path, { force: true })
        } catch {
          stuck = true
        }
        if (existsSync(path)) stuck = true
      }
    }
    this.writeRemoved([...removed])
    const detail = stuck
      ? 'Some model files are still on disk. Chat will not use the included copy until you download a model again.'
      : 'Local model deleted. Chat uses the built-in lines until you download it again. A portable exe still contains the model inside the program file.'
    this.flash = detail
    this.push(true)
    return detail
  }

  stop(): void {
    const proc = this.proc
    this.proc = null
    this.generation += 1
    this.loadedPath = ''
    this.loadedThreads = 0
    if (!proc) return
    try {
      proc.kill()
    } catch {
      // The process is already gone.
    }
  }

  private async generateOnce(turn: BrainTurn): Promise<ChatMessage[] | null> {
    const settings = this.opts.getSettings()
    if (settings.aiMode || !settings.localBrain) return null
    const choice = this.choice()
    if (!choice || !this.binaryPath()) return null
    const pace = paceFor(settings.brainSpeed)
    const threads = clampThreads(pace.threads, cpuCount())
    const ready = await this.ensure(choice.path, threads, 12_000)
    if (!ready || this.opts.getSettings().aiMode || !this.opts.getSettings().localBrain) return null
    const prompt = buildBrainPrompt(turn, pace)
    try {
      const content = await this.complete(prompt.system, prompt.user, pace.maxTokens, pace.timeoutMs)
      if (!content) return null
      const messages = messagesFromBrain(content, {
        now: turn.now,
        rng: turn.rng,
        avoid: new Set(turn.avoid.map((name) => name.toLowerCase()))
      })
      return messages.length ? messages : null
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      this.opts.log(name === 'TimeoutError' || name === 'AbortError' ? 'local brain was too slow' : 'local brain failed')
      return null
    }
  }

  private async complete(system: string, user: string, maxTokens: number, timeoutMs: number): Promise<string | null> {
    const first = await this.postChat(system, user, maxTokens, timeoutMs, this.schema)
    if (first.status === 400 && this.schema) {
      this.schema = false
      const second = await this.postChat(system, user, maxTokens, timeoutMs, false)
      return second.text
    }
    return first.text
  }

  private async postChat(
    system: string,
    user: string,
    maxTokens: number,
    timeoutMs: number,
    schema: boolean
  ): Promise<{ status: number; text: string | null }> {
    const body: Record<string, unknown> = {
      model: 'local',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      max_tokens: maxTokens,
      temperature: 0.8,
      stream: false
    }
    if (schema) {
      body.response_format = {
        type: 'json_object',
        schema: {
          type: 'object',
          properties: {
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  username: { type: 'string' },
                  message: { type: 'string' },
                  badge: { type: 'string' }
                },
                required: ['username', 'message']
              }
            }
          },
          required: ['messages']
        }
      }
    }
    const response = await fetch(`http://127.0.0.1:${this.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) return { status: response.status, text: null }
    return { status: response.status, text: extractAssistantText(await response.json()) }
  }

  private async ensure(path: string, threads: number, waitMs: number): Promise<boolean> {
    if (!this.proc || this.exited || this.loadedPath !== path || this.loadedThreads !== threads) {
      this.stop()
      this.launch(path, threads)
    }
    return this.waitHealthy(waitMs)
  }

  private launch(modelPath: string, threads: number): void {
    const bin = this.binaryPath()
    if (!bin) return
    const generation = ++this.generation
    const args = [
      '-m', modelPath,
      '--host', '127.0.0.1',
      '--port', String(this.port),
      '-c', '2048',
      '-t', String(threads),
      '-tb', String(threads),
      '-np', '1',
      '-ngl', '0',
      '--fit', 'off',
      '--no-warmup',
      '--prio', '-1',
      '--poll', '0',
      '--cache-ram', '64',
      '--alias', 'local'
    ]
    const child = spawn(bin, args, {
      cwd: dirname(bin),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.proc = child
    this.exited = false
    this.loadedPath = modelPath
    this.loadedThreads = threads
    let bumped = false
    const take = (chunk: Buffer): void => {
      if (generation !== this.generation || bumped) return
      if (!/address already in use/i.test(chunk.toString('utf8')) || this.port >= 39230) return
      bumped = true
      this.port += 1
      child.kill()
      this.launch(modelPath, threads)
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.on('exit', () => {
      if (generation !== this.generation) return
      this.exited = true
      if (this.proc === child) this.proc = null
    })
    if (child.pid) {
      try {
        setPriority(child.pid, 19)
      } catch {
        // --prio -1 still asks llama.cpp to run below normal.
      }
    }
  }

  private async waitHealthy(waitMs: number): Promise<boolean> {
    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      if (!this.proc || this.exited) return false
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/health`, { signal: AbortSignal.timeout(1000) })
        if (response.ok) return true
      } catch {
        // The model is still loading.
      }
      await delay(400)
    }
    return false
  }

  private async streamModel(url: string, total: number, partial: string, signal: AbortSignal, reset = true): Promise<void> {
    let existing = 0
    try {
      existing = statSync(partial).size
    } catch {
      existing = 0
    }
    if (existing > total) {
      rmSync(partial, { force: true })
      existing = 0
    }
    if (existing === total && total > 0) return
    const headers: Record<string, string> = { 'User-Agent': 'ChatMode/0.5.0' }
    const range = resumeHeader(existing)
    if (range) headers.Range = range.Range
    const response = await fetch(url, { headers, redirect: 'follow', signal })
    if (response.status === 416 && reset) {
      rmSync(partial, { force: true })
      return this.streamModel(url, total, partial, signal, false)
    }
    if (response.status !== 200 && response.status !== 206) throw new Error('download failed')
    const append = response.status === 206 && existing > 0
    if (!append) existing = 0
    if (!response.body) throw new Error('empty download')
    let got = existing
    let last = 0
    const progress = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        got += chunk.length
        const now = Date.now()
        if (now - last > 250) {
          last = now
          this.progress = total > 0 ? Math.min(1, got / total) : 0
          this.push(false)
        }
        callback(null, chunk)
      }
    })
    const flags = append ? 'a' : 'w'
    await pipeline(Readable.fromWeb(response.body as never), progress, createWriteStream(partial, { flags }))
    this.progress = 1
    this.push(true)
  }

  private choice(): (ModelChoice & { path: string }) | null {
    const picked = chooseModel(this.opts.getSettings().brainSize, this.presence())
    if (!picked) return null
    const spec = modelSpec(picked.size)
    const path = picked.source === 'downloaded' ? this.downloadPath(spec.file) : this.bundlePath(spec.file)
    return { ...picked, path }
  }

  private presence(): ModelPresence[] {
    const removed = new Set(this.readRemoved())
    const found: ModelPresence[] = []
    for (const size of SIZES) {
      const spec = modelSpec(size)
      const downloaded = this.fileBytes(this.downloadPath(spec.file))
      if (downloaded > 0) {
        found.push({ size, source: 'downloaded', bytes: downloaded, expected: spec.bytes, removed: removed.has(spec.file) })
      }
      const bundled = this.fileBytes(this.bundlePath(spec.file))
      if (bundled > 0) {
        found.push({ size, source: 'bundled', bytes: bundled, expected: spec.bytes, removed: removed.has(spec.file) })
      }
    }
    return found
  }

  private deletable(): boolean {
    if (this.presence().length > 0) return true
    for (const size of SIZES) {
      if (existsSync(`${this.downloadPath(modelSpec(size).file)}.partial`)) return true
    }
    return false
  }

  private fileBytes(path: string): number {
    try {
      return statSync(path).size
    } catch {
      return 0
    }
  }

  private downloadPath(file: string): string {
    return join(this.opts.userDataDir, 'brain', 'models', file)
  }

  private bundlePath(file: string): string {
    return join(this.opts.resourceDir, 'models', file)
  }

  private binaryPath(): string | null {
    const name = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
    const path = join(this.opts.resourceDir, 'bin', name)
    return existsSync(path) ? path : null
  }

  private removedFile(): string {
    return join(this.opts.userDataDir, 'brain', 'removed.json')
  }

  private readRemoved(): string[] {
    try {
      const parsed = JSON.parse(readFileSync(this.removedFile(), 'utf8')) as { files?: unknown }
      if (!Array.isArray(parsed.files)) return []
      return parsed.files.filter((file): file is string => typeof file === 'string').slice(0, 20)
    } catch {
      return []
    }
  }

  private writeRemoved(files: string[]): void {
    const dir = join(this.opts.userDataDir, 'brain')
    mkdirSync(dir, { recursive: true })
    writeFileSync(this.removedFile(), JSON.stringify({ files }))
  }

  private unremove(file: string): void {
    this.writeRemoved(this.readRemoved().filter((item) => item !== file))
  }

  private push(force: boolean): void {
    const now = Date.now()
    if (!force && now - this.lastNotify < 250) return
    this.lastNotify = now
    this.opts.notify()
  }
}
