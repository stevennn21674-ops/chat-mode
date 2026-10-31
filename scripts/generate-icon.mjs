import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, checksum])
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1)
    raw[start] = 0
    rgba.copy(raw, start + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function insideRoundRect(x, y, left, top, width, height, radius) {
  const right = left + width - 1
  const bottom = top + height - 1
  if (x < left || y < top || x > right || y > bottom) return false
  let dx = 0
  let dy = 0
  if (x < left + radius) dx = left + radius - x
  else if (x > right - radius) dx = x - (right - radius)
  if (y < top + radius) dy = top + radius - y
  else if (y > bottom - radius) dy = y - (bottom - radius)
  return dx * dx + dy * dy <= radius * radius
}

function draw(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const bubble = {
    left: Math.round(size * 0.14),
    top: Math.round(size * 0.16),
    width: Math.round(size * 0.72),
    height: Math.round(size * 0.56),
    radius: Math.round(size * 0.16)
  }
  const dots = [0.32, 0.5, 0.68].map((t) => ({
    x: bubble.left + bubble.width * t,
    y: bubble.top + bubble.height * 0.48,
    r: Math.max(2, size * 0.045)
  }))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      const inBubble = insideRoundRect(x, y, bubble.left, bubble.top, bubble.width, bubble.height, bubble.radius)
      const tail = x > size * 0.22 && x < size * 0.42 && y > size * 0.62 && y < size * 0.8 && y < size * 0.84 - (x - size * 0.22) * 0.7
      if (inBubble || tail) {
        r = 109
        g = 94
        b = 252
        a = 255
      }
      for (const dot of dots) {
        const dx = x - dot.x
        const dy = y - dot.y
        if (dx * dx + dy * dy <= dot.r * dot.r) {
          r = 232
          g = 255
          b = 244
          a = 255
        }
      }
      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = a
    }
  }
  return png(size, size, rgba)
}

function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + images.length * 16
  const blobs = []
  for (const image of images) {
    const entry = Buffer.alloc(16)
    entry[0] = image.size >= 256 ? 0 : image.size
    entry[1] = image.size >= 256 ? 0 : image.size
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(image.png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    blobs.push(image.png)
    offset += image.png.length
  }
  return Buffer.concat([header, ...entries, ...blobs])
}

const sizes = [16, 32, 48, 256]
const images = sizes.map((size) => ({ size, png: draw(size) }))
const buildDir = resolve(root, 'build')
const iconDir = resolve(root, 'resources/icons')
mkdirSync(buildDir, { recursive: true })
mkdirSync(iconDir, { recursive: true })
writeFileSync(resolve(buildDir, 'icon.png'), images[3].png)
writeFileSync(resolve(buildDir, 'tray.png'), images[1].png)
writeFileSync(resolve(buildDir, 'icon.ico'), ico(images))
writeFileSync(resolve(iconDir, 'icon.png'), images[3].png)
writeFileSync(resolve(iconDir, 'tray.png'), images[1].png)
console.log('Wrote app icons')
