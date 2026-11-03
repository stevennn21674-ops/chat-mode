import { desktopCapturer, nativeImage, screen, type NativeImage } from 'electron'
import { differenceHash } from '../shared/frame-diff'
import { sceneCue, type SceneCue } from '../shared/scene-cues'
import { dominantColorNames, isMostlyBlack } from '../shared/screen-cues'

export const DEMO_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUQEhIVFRUVFRUYFxUYFxcVFRgVFxUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGhAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAMAAQMBIgACEQEDEQH/xAAbAAABBQEBAAAAAAAAAAAAAAADAAIEBQYBB//EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAAAf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJpA//9k='

export interface CapturedFrame {
  jpegBase64: string
  hash: string
  colors: string[]
  title: string | null
  scene: SceneCue
}

export function hashImage(image: NativeImage): string {
  const small = image.resize({ width: 9, height: 8, quality: 'good' })
  const bitmap = small.toBitmap()
  const gray = new Uint8Array(9 * 8)
  const pixelCount = Math.min(gray.length, Math.floor(bitmap.length / 4))
  for (let i = 0; i < pixelCount; i++) {
    const b = bitmap[i * 4] ?? 0
    const g = bitmap[i * 4 + 1] ?? 0
    const r = bitmap[i * 4 + 2] ?? 0
    gray[i] = Math.round(0.3 * r + 0.59 * g + 0.11 * b)
  }
  return differenceHash(gray, 9, 8)
}

function colorsOf(image: NativeImage): string[] {
  try {
    const bitmap = image.toBitmap()
    if (bitmap.length < 16) return []
    return dominantColorNames(bitmap)
  } catch {
    return []
  }
}

let titleCache: { at: number; title: string | null } = { at: 0, title: null }

async function foregroundTitle(): Promise<string | null> {
  try {
    const windows = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: false
    })
    for (const win of windows) {
      const name = win.name?.trim()
      if (!name) continue
      if (/chat mode/i.test(name)) continue
      return name.slice(0, 80)
    }
  } catch {
    return null
  }
  return null
}

function frameFrom(image: NativeImage, title: string | null): CapturedFrame | null {
  if (image.isEmpty()) return null
  try {
    if (isMostlyBlack(image.toBitmap())) return null
  } catch {
    return null
  }
  const jpeg = image.toJPEG(60)
  const hashed = nativeImage.createFromBuffer(jpeg)
  const size = image.getSize()
  let bitmap = new Uint8Array(0)
  try {
    bitmap = new Uint8Array(image.toBitmap())
  } catch {
    bitmap = new Uint8Array(0)
  }
  return {
    jpegBase64: jpeg.toString('base64'),
    hash: hashed.isEmpty() ? '' : hashImage(hashed),
    colors: colorsOf(image),
    title,
    scene: sceneCue(bitmap, size.width, size.height)
  }
}

async function cachedTitle(ttl: number): Promise<string | null> {
  if (Date.now() - titleCache.at < ttl) return titleCache.title
  const title = await foregroundTitle()
  titleCache = { at: Date.now(), title }
  return title
}

export async function captureWatchFrame(
  thumb: { width: number; height: number } = { width: 32, height: 18 },
  titleTtl = 8000
): Promise<{ bgra: Uint8Array; title: string | null } | null> {
  const display = screen.getPrimaryDisplay()
  const [sources, title] = await Promise.all([
    desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.max(16, thumb.width), height: Math.max(9, thumb.height) },
      fetchWindowIcons: false
    }),
    cachedTitle(titleTtl)
  ])
  const primary = sources.find((source) => source.display_id === String(display.id)) ?? sources[0]
  if (!primary || primary.thumbnail.isEmpty()) return null
  try {
    const bgra = primary.thumbnail.toBitmap()
    if (bgra.length < 64) return null
    return { bgra, title }
  } catch {
    return null
  }
}

export async function capturePrimaryJpeg(): Promise<CapturedFrame | null> {
  const display = screen.getPrimaryDisplay()
  const sourceWidth = Math.max(1, display.size.width)
  const sourceHeight = Math.max(1, display.size.height)
  const scale = 512 / Math.max(sourceWidth, sourceHeight)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const [sources, title] = await Promise.all([
    desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
      fetchWindowIcons: false
    }),
    foregroundTitle()
  ])
  const primary = sources.find((source) => source.display_id === String(display.id)) ?? sources[0]
  const direct = primary ? frameFrom(primary.thumbnail, title) : null
  if (direct) return direct
  let windows: Awaited<ReturnType<typeof desktopCapturer.getSources>> = []
  try {
    windows = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width, height },
      fetchWindowIcons: false
    })
  } catch {
    return null
  }
  for (const win of windows) {
    if (/chat mode/i.test(win.name ?? '')) continue
    const frame = frameFrom(win.thumbnail, title ?? win.name ?? null)
    if (frame) return frame
  }
  return null
}
