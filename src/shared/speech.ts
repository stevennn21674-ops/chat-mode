import { isKidSafe } from './filter'

export function usableTranscript(text: string): string {
  const clean = text.trim().slice(0, 400)
  if (clean.length < 2 || !isKidSafe(clean)) return ''
  return clean
}
