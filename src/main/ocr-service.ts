import { createRequire } from 'node:module'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { nativeImage } from 'electron'
import { cleanOcrText, ocrCrop, OCR_LANG_BYTES, OCR_LANG_URL } from '../shared/ocr-text'

interface OcrOptions {
  dir: string
  log: (line: string) => void
  notify: () => void
  online: () => boolean
  enabled: () => boolean
}

interface OcrWorker {
  recognize: (image: Buffer, options?: Record<string, string>) => Promise<{ data: { text?: string } }>
  terminate: () => Promise<unknown>
}

const nodeRequire = createRequire(import.meta.url)

function unpacked(path: string): string {
  return path.replace(`${join('app.asar', '')}`, join('app.asar.unpacked', ''))
}

function workerFile(): string {
  return unpacked(nodeRequire.resolve('tesseract.js/src/worker-script/node/index.js'))
}

export class OcrService {
  private worker: OcrWorker | null = null
  private loading: Promise<OcrWorker | null> | null = null
  private downloading = false
  private busy = false
  private lastHash = ''
  private lastText = ''
  private lastAt = 0
  private note = 'On-screen text uses a small English file downloaded the first time it is needed.'

  constructor(private opts: OcrOptions) {}

  status(): string {
    return this.note
  }

  bytes(): number {
    const file = this.langFile()
    try {
      return statSync(file).size
    } catch {
      return 0
    }
  }

  async prepare(): Promise<void> {
    if (!this.opts.enabled() || !this.opts.online() || this.downloading || this.readyFile()) return
    await this.ensureLang()
  }

  async read(jpegBase64: string, hash: string): Promise<string> {
    if (!this.opts.enabled()) return ''
    if (hash && hash === this.lastHash && this.lastText) return this.lastText
    if (this.busy) return this.lastText
    if (this.lastAt && Date.now() - this.lastAt < 2000) return this.lastText
    this.busy = true
    this.lastAt = Date.now()
    try {
      const lang = await this.ensureLang()
      if (!lang) return ''
      const worker = await this.ensureWorker(lang)
      if (!worker) return ''
      const image = this.prepareImage(jpegBase64)
      if (!image) return ''
      const result = await Promise.race([
        worker.recognize(image, { tessedit_pageseg_mode: '11' }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))
      ])
      const text = cleanOcrText(result?.data?.text ?? '')
      if (hash) this.lastHash = hash
      this.lastText = text
      if (text) this.note = 'On-screen text is on. Recognized words are added when the picture changes.'
      return text
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed'
      this.opts.log(`on-screen text failed: ${message}`)
      this.note = 'On-screen text failed. Chat is using colors, motion, and the window title instead.'
      this.opts.notify()
      return ''
    } finally {
      this.busy = false
    }
  }

  wipe(): void {
    const worker = this.worker
    this.worker = null
    this.loading = null
    this.lastHash = ''
    this.lastText = ''
    if (worker) void worker.terminate().catch(() => undefined)
    rmSync(this.opts.dir, { recursive: true, force: true })
    this.note = 'On-screen text data deleted. It downloads again the next time text reading is on.'
    this.opts.notify()
  }

  private langFile(): string {
    return join(this.opts.dir, 'eng.traineddata.gz')
  }

  private readyFile(): boolean {
    try {
      return statSync(this.langFile()).size === OCR_LANG_BYTES
    } catch {
      return false
    }
  }

  private async ensureLang(): Promise<string | null> {
    if (this.readyFile()) return this.opts.dir
    if (!this.opts.online()) {
      this.note = 'On-screen text needs a one-time 1.9 MB download, and this PC is offline.'
      this.opts.notify()
      return null
    }
    if (this.downloading) return null
    this.downloading = true
    this.note = 'Downloading English on-screen text data (1.9 MB)…'
    this.opts.notify()
    mkdirSync(this.opts.dir, { recursive: true })
    const dest = this.langFile()
    try {
      const response = await fetch(OCR_LANG_URL, { redirect: 'follow', signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw new Error(`download ${response.status}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length !== OCR_LANG_BYTES) throw new Error(`unexpected size ${bytes.length}`)
      writeFileSync(dest, bytes)
      this.note = 'English on-screen text data is saved on this PC (1.9 MB).'
      this.opts.log('on-screen text data saved')
      return this.opts.dir
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed'
      this.opts.log(`on-screen text download failed: ${message}`)
      this.note = 'The on-screen text download failed. Chat still uses colors, motion, and the window title.'
      return null
    } finally {
      this.downloading = false
      this.opts.notify()
    }
  }

  private prepareImage(jpegBase64: string): Buffer | null {
    try {
      const image = nativeImage.createFromBuffer(Buffer.from(jpegBase64, 'base64'))
      if (image.isEmpty()) return null
      const size = image.getSize()
      const crop = ocrCrop(size.width, size.height)
      const cropped = image.crop(crop)
      const long = Math.max(crop.width, crop.height)
      const scale = long > 480 ? 480 / long : 1
      const resized = scale < 1
        ? cropped.resize({ width: Math.max(1, Math.round(crop.width * scale)), height: Math.max(1, Math.round(crop.height * scale)) })
        : cropped
      return resized.toJPEG(70)
    } catch {
      return null
    }
  }

  private async ensureWorker(langDir: string): Promise<OcrWorker | null> {
    if (this.worker) return this.worker
    if (this.loading) return this.loading
    this.loading = this.openWorker(langDir)
    try {
      this.worker = await this.loading
      return this.worker
    } finally {
      this.loading = null
    }
  }

  private async openWorker(langDir: string): Promise<OcrWorker | null> {
    if (!existsSync(workerFile())) {
      this.note = 'On-screen text engine is missing from this build.'
      this.opts.notify()
      return null
    }
    try {
      return await this.create(langDir)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed'
      this.opts.log(`on-screen text engine failed: ${message}`)
      this.note = 'On-screen text failed. Chat is using colors, motion, and the window title instead.'
      this.opts.notify()
      return null
    }
  }

  private async create(langDir: string): Promise<OcrWorker | null> {
    const imported = (await import('tesseract.js')) as unknown as {
      createWorker?: (lang: string, oem: number, options: Record<string, unknown>) => Promise<OcrWorker>
      default?: { createWorker?: (lang: string, oem: number, options: Record<string, unknown>) => Promise<OcrWorker> }
    }
    const createWorker = imported.createWorker ?? imported.default?.createWorker
    if (!createWorker) return null
    return createWorker('eng', 1, {
      workerPath: workerFile(),
      langPath: langDir,
      cachePath: langDir,
      gzip: true,
      errorHandler: (error: unknown) => this.opts.log(`on-screen text engine: ${String(error).slice(0, 160)}`)
    })
  }
}
