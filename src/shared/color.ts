export const NAME_COLORS = [
  '#ff8ec8',
  '#8eb6ff',
  '#7dffa8',
  '#ffd36e',
  '#ffae8a',
  '#d2b0ff',
  '#7aefff',
  '#ffe28a',
  '#ffb4b4',
  '#c6ff8a',
  '#f5b0ff',
  '#9ad0ff'
]

function luma(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function colorFor(name: string, provided?: string): string {
  if (provided && /^#[0-9a-fA-F]{6}$/.test(provided) && luma(provided) >= 110) {
    return provided.toLowerCase()
  }
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 33 + name.charCodeAt(i)) >>> 0
  return NAME_COLORS[hash % NAME_COLORS.length]
}
