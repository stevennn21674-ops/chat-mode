export const PC_AUDIO_SECONDS = 18
export const SILENCE_RMS = 0.01

export function pcmRms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  const step = Math.max(1, Math.floor(samples.length / 4000))
  let sum = 0
  let count = 0
  for (let i = 0; i < samples.length; i += step) {
    const sample = samples[i] ?? 0
    sum += sample * sample
    count += 1
  }
  return Math.sqrt(sum / count)
}

export function isSilentPcm(samples: Float32Array, threshold = SILENCE_RMS): boolean {
  return pcmRms(samples) < threshold
}

export const LOUD_RMS = 0.12

export function isLoudPcm(samples: Float32Array, threshold = LOUD_RMS): boolean {
  return samples.length > 0 && pcmRms(samples) >= threshold
}

export class PcmWindow {
  private chunks: Float32Array[] = []
  private sampleRate = 0
  private total = 0

  constructor(private readonly seconds = PC_AUDIO_SECONDS) {}

  push(chunk: Float32Array, sampleRate: number): void {
    if (chunk.length === 0 || sampleRate <= 0) return
    if (this.sampleRate && this.sampleRate !== sampleRate) this.clear()
    this.sampleRate = sampleRate
    this.chunks.push(chunk)
    this.total += chunk.length
    const max = Math.floor(sampleRate * this.seconds)
    while (this.total > max && this.chunks.length > 1) {
      const dropped = this.chunks.shift()
      if (!dropped) break
      this.total -= dropped.length
    }
    if (this.total > max && this.chunks[0]) {
      const only = this.chunks[0]
      this.chunks[0] = only.subarray(only.length - max)
      this.total = this.chunks[0].length
    }
  }

  snapshot(): { samples: Float32Array; sampleRate: number } | null {
    if (!this.total || !this.sampleRate) return null
    const samples = new Float32Array(this.total)
    let offset = 0
    for (const chunk of this.chunks) {
      samples.set(chunk, offset)
      offset += chunk.length
    }
    return { samples, sampleRate: this.sampleRate }
  }

  clear(): void {
    this.chunks = []
    this.sampleRate = 0
    this.total = 0
  }
}

export function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input
  if (inRate <= 0 || outRate <= 0) return new Float32Array()
  const ratio = inRate / outRate
  const length = Math.floor(input.length / ratio)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)))
    let sum = 0
    let count = 0
    for (let j = start; j < end; j++) {
      sum += input[j]
      count += 1
    }
    out[i] = count ? sum / count : 0
  }
  return out
}

export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Buffer {
  const dataSize = samples.length * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(sample < 0 ? sample * 0x8000 : sample * 0x7fff, 44 + i * 2)
  }
  return buffer
}
