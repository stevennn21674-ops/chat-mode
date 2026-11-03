export type PerformanceMode = 'low' | 'balanced' | 'high'

export interface PerfProfile {
  loopback: boolean
  loopbackEveryMs: number
  watchBaseMs: number
  watchStillMs: number
  thumb: { width: number; height: number }
  titleCacheMs: number
}

export function perfProfile(mode: PerformanceMode): PerfProfile {
  if (mode === 'high') {
    return {
      loopback: true,
      loopbackEveryMs: 30_000,
      watchBaseMs: 2500,
      watchStillMs: 8000,
      thumb: { width: 48, height: 27 },
      titleCacheMs: 6000
    }
  }
  if (mode === 'low') {
    return {
      loopback: false,
      loopbackEveryMs: 45_000,
      watchBaseMs: 8000,
      watchStillMs: 15_000,
      thumb: { width: 32, height: 18 },
      titleCacheMs: 12_000
    }
  }
  return {
    loopback: true,
    loopbackEveryMs: 45_000,
    watchBaseMs: 5000,
    watchStillMs: 12_000,
    thumb: { width: 32, height: 18 },
    titleCacheMs: 8000
  }
}

export function cpuAverage(samples: number[]): number | null {
  if (!samples.length) return null
  const total = samples.reduce((sum, value) => sum + value, 0)
  return total / samples.length
}

export function shouldThrottle(cpu10s: number | null, fps: number | null): boolean {
  if (cpu10s !== null && cpu10s > 70) return true
  if (fps !== null && fps > 0 && fps < 24) return true
  return false
}

export function effectiveMode(mode: PerformanceMode, throttled: boolean): PerformanceMode {
  if (!throttled) return mode
  if (mode === 'high') return 'balanced'
  return 'low'
}
