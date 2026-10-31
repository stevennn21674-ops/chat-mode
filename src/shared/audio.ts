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
