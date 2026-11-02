import { hammingHex } from './frame-diff'

export interface ScreenCue {
  change: number
  colors: string[]
  title: string | null
}

export function screenChange(previous: string | null, next: string): number {
  if (!previous || !next) return 0.75
  if (previous === next) return 0
  const hex = /^[0-9a-f]+$/i
  if (!hex.test(previous) || !hex.test(next)) return 0.8
  const bits = Math.max(previous.length, next.length) * 4
  if (!bits) return 0
  return Math.min(1, hammingHex(previous, next) / bits)
}

function colorName(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const light = (max + min) / 2
  if (max - min < 22) {
    if (light < 45) return 'black'
    if (light < 100) return 'dark'
    if (light > 210) return 'white'
    return 'gray'
  }
  if (light < 48) return 'dark'
  if (r > 170 && g > 140 && b < 110) return 'yellow'
  if (r > g + 25 && r > b + 25) return g > 90 ? 'orange' : 'red'
  if (g > r + 15 && g >= b) return 'green'
  if (b > r + 15 && b > g + 10) return 'blue'
  if (r > 130 && b > 130 && g < 130) return 'purple'
  if (r > 170 && b > 120 && g > 90) return 'pink'
  return light > 170 ? 'bright' : 'dark'
}

export function isMostlyBlack(bitmap: Uint8Array, threshold = 14): boolean {
  if (bitmap.length < 16) return true
  const pixels = Math.floor(bitmap.length / 4)
  const step = Math.max(1, Math.floor(pixels / 500))
  let sum = 0
  let count = 0
  for (let pixel = 0; pixel < pixels; pixel += step) {
    const index = pixel * 4
    sum += (bitmap[index] ?? 0) + (bitmap[index + 1] ?? 0) + (bitmap[index + 2] ?? 0)
    count += 1
  }
  return count === 0 || sum / (count * 3) < threshold
}

export function dominantColorNames(bgra: Uint8Array): string[] {
  if (bgra.length < 4) return []
  const scores = new Map<string, number>()
  const pixels = Math.floor(bgra.length / 4)
  const step = Math.max(1, Math.floor(pixels / 48))
  for (let pixel = 0; pixel < pixels; pixel += step) {
    const index = pixel * 4
    const name = colorName(bgra[index + 2] ?? 0, bgra[index + 1] ?? 0, bgra[index] ?? 0)
    scores.set(name, (scores.get(name) ?? 0) + 1)
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name)
}
