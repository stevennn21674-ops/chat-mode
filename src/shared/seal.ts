import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export interface SealedBlob {
  v: 1
  iv: string
  parts: string[]
  mask: number[]
  data: string
}

export function sealJson(value: unknown, key: Buffer = randomBytes(32)): SealedBlob {
  if (key.length !== 32) throw new Error('seal key must be 32 bytes')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const parts: string[] = []
  const mask: number[] = []
  for (let i = 0; i < 4; i++) {
    const piece = 1 + Math.floor(Math.random() * 255)
    mask.push(piece)
    const chunk = Buffer.from(key.subarray(i * 8, i * 8 + 8))
    for (let j = 0; j < chunk.length; j++) chunk[j] ^= piece
    parts.push(chunk.toString('base64'))
  }
  return {
    v: 1,
    iv: iv.toString('base64'),
    parts,
    mask,
    data: Buffer.concat([enc, tag]).toString('base64')
  }
}

export function unsealJson(blob: SealedBlob): unknown {
  if (!blob || blob.v !== 1 || blob.parts.length !== 4 || blob.mask.length !== 4) {
    throw new Error('unreadable sealed blob')
  }
  const chunks: Buffer[] = []
  for (let i = 0; i < 4; i++) {
    const chunk = Buffer.from(blob.parts[i], 'base64')
    const piece = blob.mask[i]
    if (!Number.isInteger(piece) || piece < 0 || piece > 255) throw new Error('unreadable sealed blob')
    for (let j = 0; j < chunk.length; j++) chunk[j] ^= piece
    chunks.push(chunk)
  }
  const key = Buffer.concat(chunks)
  if (key.length !== 32) throw new Error('unreadable sealed blob')
  const raw = Buffer.from(blob.data, 'base64')
  if (raw.length < 17) throw new Error('unreadable sealed blob')
  const tag = raw.subarray(raw.length - 16)
  const enc = raw.subarray(0, raw.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'))
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  return JSON.parse(plain) as unknown
}
