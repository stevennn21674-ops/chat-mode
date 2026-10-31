import { LIMITS } from './types'

const RANGES: Record<number, [number, number]> = {
  1: [2600, 4200],
  2: [1800, 3000],
  3: [1200, 2100],
  4: [800, 1500],
  5: [480, 980],
  6: [260, 620],
  7: [120, 320]
}

export function clampSpeed(level: number): number {
  if (!Number.isFinite(level)) return 4
  return Math.min(LIMITS.speedMax, Math.max(LIMITS.speedMin, Math.round(level)))
}

export function stepSpeed(level: number, direction: 'slower' | 'faster'): number {
  const delta = direction === 'faster' ? 1 : -1
  return clampSpeed(clampSpeed(level) + delta)
}

export function delayRangeMs(level: number): [number, number] {
  return RANGES[clampSpeed(level)]
}

export function speedMidpoint(level: number): number {
  const [min, max] = delayRangeMs(level)
  return (min + max) / 2
}
