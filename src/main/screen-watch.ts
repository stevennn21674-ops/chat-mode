import { effectiveMode, perfProfile } from '../shared/performance'
import type { AppSettings } from '../shared/types'
import { captureWatchFrame } from './capture'
import {
  classifyActivity,
  detectGame,
  sampleFrame,
  shouldSample,
  watchIntervalMs,
  type ActivityEvent,
  type FrameSample
} from '../shared/screen-activity'

export class ScreenWatch {
  private timer: NodeJS.Timeout | null = null
  private previous: Uint8Array | null = null
  private prevSample: FrameSample | null = null
  private still = 0
  private lastKey = ''
  private lastEmit = 0
  private alive = true

  constructor(
    private deps: {
      getSettings: () => AppSettings
      power: () => { idle: boolean; onBattery: boolean }
      onActivity: (event: ActivityEvent) => void
      log: (message: string) => void
      throttled?: () => boolean
    }
  ) {}

  start(): void {
    this.alive = true
    this.schedule(1500)
  }

  stop(): void {
    this.alive = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(ms: number): void {
    if (!this.alive) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.tick()
    }, ms)
  }

  private async tick(): Promise<void> {
    if (!this.alive) return
    const settings = this.deps.getSettings()
    const power = this.deps.power()
    const profile = perfProfile(effectiveMode(settings.performanceMode, this.deps.throttled?.() ?? false))
    if (!shouldSample({
      enabled: settings.screenWatch,
      chatEnabled: settings.enabled,
      onBattery: power.onBattery,
      pauseOnBattery: settings.pauseWatchOnBattery,
      idle: power.idle,
      cpuHigh: this.deps.throttled?.() ?? false
    })) {
      this.schedule(profile.watchStillMs)
      return
    }
    try {
      const frame = await captureWatchFrame(profile.thumb, profile.titleCacheMs)
      if (!this.alive || !frame) {
        this.schedule(watchIntervalMs(this.still, profile.watchBaseMs, profile.watchStillMs))
        return
      }
      const sample = sampleFrame(frame.bgra, this.previous)
      const previousSample = this.prevSample
      this.still = sample.motion < 0.02 ? this.still + 1 : 0
      const unchanged = sample.motion < 0.02
      const game = detectGame(frame.title)
      this.previous = frame.bgra
      this.prevSample = sample
      if (game && unchanged && this.still >= 2) {
        this.schedule(profile.watchStillMs)
        return
      }
      const event = classifyActivity({
        sample,
        previous: previousSample,
        title: frame.title,
        stillFrames: this.still,
        at: Date.now()
      })
      const key = `${event.state}:${event.game ?? ''}`
      const repeat = (event.state === 'scare' || event.state === 'death') && Date.now() - this.lastEmit > 8000 && event.big
      if (key !== this.lastKey || repeat) {
        this.lastKey = key
        this.lastEmit = Date.now()
        this.deps.onActivity(event)
      }
    } catch {
      this.deps.log('screen watch failed')
    }
    const pace = perfProfile(effectiveMode(this.deps.getSettings().performanceMode, this.deps.throttled?.() ?? false))
    this.schedule(watchIntervalMs(this.still, pace.watchBaseMs, pace.watchStillMs))
  }
}
