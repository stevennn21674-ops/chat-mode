import { desktopCapturer, nativeImage, screen, type NativeImage } from 'electron'
import { differenceHash } from '../shared/frame-diff'

export const DEMO_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUQEhIVFRUVFRUYFxUYFxcVFRgVFxUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGhAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAMAAQMBIgACEQEDEQH/xAAbAAABBQEBAAAAAAAAAAAAAAADAAIEBQYBB//EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAAAf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJpA//9k='

export interface CapturedFrame {
  jpegBase64: string
  hash: string
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

export async function capturePrimaryJpeg(): Promise<CapturedFrame | null> {
  const display = screen.getPrimaryDisplay()
  const sourceWidth = Math.max(1, display.size.width)
  const sourceHeight = Math.max(1, display.size.height)
  const scale = 512 / Math.max(sourceWidth, sourceHeight)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false
  })
  if (sources.length === 0) return null
  const primary = sources.find((source) => source.display_id === String(display.id)) ?? sources[0]
  if (primary.thumbnail.isEmpty()) return null
  const jpeg = primary.thumbnail.toJPEG(60)
  const hashed = nativeImage.createFromBuffer(jpeg)
  return {
    jpegBase64: jpeg.toString('base64'),
    hash: hashed.isEmpty() ? '' : hashImage(hashed)
  }
}
