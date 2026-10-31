export interface CallUsage {
  timestamps: number[]
}

export const HOUR_MS = 60 * 60 * 1000

export function emptyUsage(): CallUsage {
  return { timestamps: [] }
}

export function pruneUsage(usage: CallUsage, now: number, windowMs = HOUR_MS): CallUsage {
  return { timestamps: usage.timestamps.filter((stamp) => now - stamp < windowMs && stamp <= now) }
}

export function callsInWindow(usage: CallUsage, now: number, windowMs = HOUR_MS): number {
  return pruneUsage(usage, now, windowMs).timestamps.length
}

export function recordCall(usage: CallUsage, now: number, windowMs = HOUR_MS): CallUsage {
  const pruned = pruneUsage(usage, now, windowMs)
  return { timestamps: [...pruned.timestamps, now].slice(-500) }
}

export function underCallCap(usage: CallUsage, limit: number, now: number, windowMs = HOUR_MS): boolean {
  if (limit <= 0) return false
  return callsInWindow(usage, now, windowMs) < limit
}

export function nextWaitMs(input: {
  captureIntervalSec: number
  ecoMode: boolean
  idle: boolean
  onBattery: boolean
  backoffMs: number
}): number {
  let seconds = input.captureIntervalSec
  if (input.ecoMode) seconds = Math.max(seconds, 20)
  if (input.ecoMode && input.idle) seconds = Math.min(120, Math.round(seconds * 2))
  if (input.ecoMode && input.onBattery) seconds = Math.min(120, Math.round(seconds * 1.5))
  return seconds * 1000 + Math.max(0, input.backoffMs)
}

export function batchPlan(ecoMode: boolean): { count: number; maxTokens: number } {
  if (ecoMode) return { count: 8, maxTokens: 280 }
  return { count: 5, maxTokens: 400 }
}

export type SkipReason = 'ok' | 'unchanged' | 'capped' | 'offline'

export function shouldCallModel(input: {
  reason: 'interval' | 'voice'
  screenChanged: boolean
  underCap: boolean
  hasService: boolean
}): SkipReason {
  if (!input.hasService) return 'offline'
  if (!input.underCap) return 'capped'
  if (input.reason === 'interval' && !input.screenChanged) return 'unchanged'
  return 'ok'
}
