import { isKidSafe } from './filter'

const LEFT = [
  'nova',
  'pixel',
  'moth',
  'kiwi',
  'quartz',
  'amber',
  'nimbus',
  'cobble',
  'yarrow',
  'lumen',
  'sprout',
  'cedar',
  'plum',
  'wisp',
  'orbit',
  'maple',
  'pebble',
  'comet',
  'indigo',
  'brook',
  'flint',
  'harbor',
  'cinder',
  'meadow',
  'rowan',
  'poppy',
  'sage',
  'otter',
  'finch',
  'marigold'
]

const RIGHT = [
  'fox',
  'byte',
  'loop',
  'drift',
  'spark',
  'lane',
  'note',
  'cloud',
  'pine',
  'wave',
  'field',
  'glass',
  'river',
  'stone',
  'wing',
  'path',
  'light',
  'song',
  'hill',
  'moss'
]

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

function cap(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}

function compose(rng: () => number): string {
  const a = pick(LEFT, rng)
  const b = pick(RIGHT, rng)
  const n = Math.floor(rng() * 100)
  const style = Math.floor(rng() * 6)
  if (style === 0) return `${a}${b}${n}`
  if (style === 1) return `${a}_${b}`
  if (style === 2) return `${a}${n}${b}`
  if (style === 3) return `${cap(a)}${cap(b)}`
  if (style === 4) return `x${cap(a)}${n}`
  return `${a}${b}`
}

export function makeUsername(rng: () => number, avoid: Set<string>): string {
  for (let attempt = 0; attempt < 16; attempt++) {
    const name = compose(rng).slice(0, 18)
    if (name.length < 3) continue
    if (avoid.has(name.toLowerCase())) continue
    if (!isKidSafe(name)) continue
    return name
  }
  const fallback = `viewer${Math.floor(rng() * 100000)}`
  return fallback
}
