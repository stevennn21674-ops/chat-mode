import { isKidSafe } from './filter'

export const OCR_LANG_URL = 'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/eng.traineddata.gz'
export const OCR_LANG_BYTES = 1_984_273

export function ocrCrop(width: number, height: number): { x: number; y: number; width: number; height: number } {
  const nextWidth = Math.max(1, Math.min(width, Math.round(width * 0.78)))
  const nextHeight = Math.max(1, Math.min(height, Math.round(height * 0.9)))
  return { x: 0, y: 0, width: nextWidth, height: nextHeight }
}

export function cleanOcrText(raw: string): string {
  const lines: string[] = []
  for (const part of raw.split(/\r?\n/)) {
    const line = part.replace(/[^A-Za-z0-9 .,:%+\-/']/g, ' ').replace(/\s+/g, ' ').trim()
    if (line.length < 2 || line.length > 80 || !isKidSafe(line)) continue
    if (lines.some((have) => have.toLowerCase() === line.toLowerCase())) continue
    lines.push(line)
    if (lines.length >= 8) break
  }
  return lines.join(' | ').slice(0, 400)
}

export interface OcrFacts {
  level: string
  health: number | null
  score: string
  labels: string[]
}

export function ocrFacts(text: string): OcrFacts {
  const clean = text.replace(/\s+/g, ' ').trim()
  const level = clean.match(/\b(?:level|lv)\s*[:=#-]?\s*(\d{1,4})\b/i)
  const health = clean.match(/\b(?:hp|health)\s*[:=#-]?\s*(\d{1,4})\b/i)
  const score = clean.match(/\bscore\s*[:=#-]?\s*(\d{1,8})\b/i)
  const labels = clean
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && word.length <= 24 && isKidSafe(word))
    .slice(0, 8)
  return {
    level: level?.[1] ? `Level ${level[1]}` : '',
    health: health?.[1] ? Number(health[1]) : null,
    score: score?.[1] ?? '',
    labels
  }
}

export function groundedLines(input: {
  ocr: string
  colors: string[]
  game: string | null
  kind: string
}): string[] {
  const facts = ocrFacts(input.ocr)
  const lines: string[] = []
  if (facts.level && isKidSafe(facts.level)) lines.push(`bro that says ${facts.level}`)
  if (facts.health !== null && facts.health <= 30) lines.push('why is your health so low')
  else if (facts.health !== null) lines.push(`health is ${facts.health}`)
  if (facts.score) lines.push(`the score says ${facts.score}`)
  if (input.game && isKidSafe(input.game)) lines.push(`this is ${input.game}`)
  const color = input.colors.find((name) => name && name !== 'black' && name !== 'white' && name !== 'gray' && name !== 'dark')
  if (color) lines.push(`why is it so ${color}`)
  if (input.kind === 'menu') lines.push('menu moment?')
  if (input.kind === 'dark') lines.push('why is it so dark')
  if (!lines.length && facts.labels[0]) lines.push(`it says ${facts.labels[0]}`)
  return lines.filter((line) => isKidSafe(line)).slice(0, 4)
}
