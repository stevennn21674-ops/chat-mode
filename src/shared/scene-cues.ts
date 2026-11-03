import { dominantColorNames } from './screen-cues'

export interface SceneCue {
  brightness: 'dark' | 'dim' | 'bright'
  textLike: boolean
  warm: boolean
  uiLikely: boolean
}

function lum(bgra: Uint8Array, index: number): number {
  const b = bgra[index] ?? 0
  const g = bgra[index + 1] ?? 0
  const r = bgra[index + 2] ?? 0
  return 0.3 * r + 0.59 * g + 0.11 * b
}

function warmPixel(bgra: Uint8Array, index: number): boolean {
  const b = bgra[index] ?? 0
  const g = bgra[index + 1] ?? 0
  const r = bgra[index + 2] ?? 0
  return r > 140 && g > 70 && g < 210 && b < 150 && r > b + 25 && r >= g
}

export function sceneCue(bgra: Uint8Array, width: number, height: number): SceneCue {
  const pixels = Math.max(0, Math.min(Math.floor(bgra.length / 4), Math.max(0, width) * Math.max(0, height)))
  if (!pixels || width < 2 || height < 2) {
    return { brightness: 'dark', textLike: false, warm: false, uiLikely: false }
  }
  const step = Math.max(1, Math.floor(pixels / 800))
  let bright = 0
  let warm = 0
  let count = 0
  for (let pixel = 0; pixel < pixels; pixel += step) {
    const index = pixel * 4
    bright += lum(bgra, index)
    if (warmPixel(bgra, index)) warm += 1
    count += 1
  }
  const average = count ? bright / count : 0
  const brightness: SceneCue['brightness'] = average < 42 ? 'dark' : average < 120 ? 'dim' : 'bright'
  const rowStep = Math.max(1, Math.floor(height / 24))
  const xStep = Math.max(1, Math.floor(width / 48))
  let rows = 0
  let textRows = 0
  for (let y = 0; y < height; y += rowStep) {
    rows += 1
    let edges = 0
    let prev = -1
    for (let x = 0; x < width; x += xStep) {
      const index = (y * width + x) * 4
      if (index + 2 >= bgra.length) break
      const value = lum(bgra, index)
      if (prev >= 0 && Math.abs(value - prev) > 48) edges += 1
      prev = value
    }
    if (edges >= 4 && edges <= 22) textRows += 1
  }
  const textLike = rows > 0 && textRows / rows >= 0.15
  const warmRatio = count ? warm / count : 0
  const colors = dominantColorNames(bgra)
  const uiLikely = textLike && (brightness === 'bright' || colors.includes('white'))
  return {
    brightness,
    textLike,
    warm: warmRatio >= 0.18,
    uiLikely
  }
}
