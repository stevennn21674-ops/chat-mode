import type { MessageKind, SoundPack } from './types'

const RATE = 22050

function clampSample(value: number): number {
  return Math.max(-32767, Math.min(32767, Math.round(value)))
}

function env(index: number, length: number): number {
  const attack = Math.min(1, index / 180)
  const release = Math.min(1, (length - index) / 900)
  return attack * release
}

function voice(pack: SoundPack, step: number, freq: number): number {
  const angle = 2 * Math.PI * freq * step
  if (pack === 'coin') return Math.sin(angle)
  if (pack === 'chime') return Math.sin(angle) * 0.7 + Math.sin(angle * 2.01) * 0.2
  if (pack === 'arcade') return Math.sign(Math.sin(angle)) * 0.55
  return (2 * ((freq * step) % 1) - 1) * 0.45
}

function kindShift(kind: MessageKind): number {
  if (kind === 'sub') return 1.25
  if (kind === 'bits') return 1.5
  if (kind === 'gift') return 0.9
  if (kind === 'raid') return 0.7
  return 1
}

export function synthTone(pack: SoundPack, kind: MessageKind = 'donation'): Uint8Array {
  const shift = kindShift(kind)
  const base = pack === 'horn' ? 220 : pack === 'arcade' ? 440 : 660
  const length = Math.floor(RATE * (pack === 'horn' ? 0.42 : 0.32))
  const samples = new Int16Array(length)
  const notes = [base * shift, base * shift * 1.5, base * shift * 2]
  for (let i = 0; i < length; i++) {
    const note = notes[Math.min(notes.length - 1, Math.floor((i / length) * notes.length))] ?? base
    const wobble = pack === 'horn' ? 1 - i / length : 1
    const sample = voice(pack, i / RATE, note * wobble) * env(i, length) * 0.85
    samples[i] = clampSample(sample * 32767)
  }
  return wav(samples, RATE)
}

function wav(samples: Int16Array, rate: number): Uint8Array {
  const data = samples.length * 2
  const buffer = new ArrayBuffer(44 + data)
  const view = new DataView(buffer)
  writeText(view, 0, 'RIFF')
  view.setUint32(4, 36 + data, true)
  writeText(view, 8, 'WAVE')
  writeText(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(view, 36, 'data')
  view.setUint32(40, data, true)
  let offset = 44
  for (const sample of samples) {
    view.setInt16(offset, sample, true)
    offset += 2
  }
  return new Uint8Array(buffer)
}

function writeText(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}
