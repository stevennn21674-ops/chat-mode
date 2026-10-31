export function differenceHash(pixels: Uint8Array, width: number, height: number): string {
  if (width < 2 || height < 1 || pixels.length < width * height) return ''
  const bits: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = pixels[y * width + x] ?? 0
      const right = pixels[y * width + x + 1] ?? 0
      bits.push(left < right ? 1 : 0)
    }
  }
  let hex = ''
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] ?? 0) << 3 | (bits[i + 1] ?? 0) << 2 | (bits[i + 2] ?? 0) << 1 | (bits[i + 3] ?? 0)
    hex += nibble.toString(16)
  }
  return hex
}

export function hammingHex(left: string, right: string): number {
  const size = Math.max(left.length, right.length)
  let distance = 0
  for (let i = 0; i < size; i++) {
    const a = Number.parseInt(left[i] ?? '0', 16)
    const b = Number.parseInt(right[i] ?? '0', 16)
    let xor = (a ^ b) & 0xf
    while (xor) {
      distance += xor & 1
      xor >>= 1
    }
  }
  return distance
}

export function frameUnchanged(previous: string | null, next: string, threshold = 6): boolean {
  if (!previous || !next) return false
  return hammingHex(previous, next) <= threshold
}
