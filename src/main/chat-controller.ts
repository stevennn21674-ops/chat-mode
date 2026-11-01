import { requestCompletion } from '../shared/ai-client'
import { batchPlan, nextWaitMs, recordCall, shouldCallModel, underCallCap, type CallUsage } from '../shared/budget'
import { demoModelJson } from '../shared/demo'
import { usableTranscript } from '../shared/speech'
import { frameUnchanged } from '../shared/frame-diff'
import { makeFallbackMessages } from '../shared/fallback'
import { produceReactions } from '../shared/pipeline'
import { coverInterval, scheduleMessages, takeDue, type ScheduledMessage } from '../shared/schedule'
import { canReachService } from '../shared/settings'
import { stepSpeed } from '../shared/speed'
import type { AppSettings, ChatMessage, OverlayState } from '../shared/types'
import { nextBackoff } from '../shared/urls'
import type { ServiceConfig } from './service-config'

interface ControllerDeps {
  getSettings: () => AppSettings
  updateSettings: (patch: { speedLevel?: number; capturePaused?: boolean }) => void
  sendMessage: (message: ChatMessage) => void
  config: () => ServiceConfig
  capture: () => Promise<{ jpegBase64: string; hash: string } | null>
  pcAudio: () => Promise<string>
  usage: () => CallUsage
  setUsage: (usage: CallUsage) => void
  power: () => { idle: boolean; onBattery: boolean }
  log: (message: string) => void
}

export class ChatController {
  private pending: ScheduledMessage[] = []
  private transcripts: string[] = []
  private recentLines: string[] = []
  private avoid: string[] = []
  private backoffMs = 0
  private voicePending = false
  private capturePending = false
  private busy = false
  private alive = true
  private pump: NodeJS.Timeout | null = null
  private timer: NodeJS.Timeout | null = null
  private analyzing = false
  private micLive = false
  private speedFlash = 0
  private micNote: string | null = null
  private micTimer: NodeJS.Timeout | null = null
  private abort: AbortController | null = null
  private lastHash: string | null = null
  private onState: (state: OverlayState) => void = () => undefined

  constructor(private deps: ControllerDeps) {}

  start(onState: (state: OverlayState) => void): void {
    this.onState = onState
    this.pump = setInterval(() => this.flush(), 80)
    this.timer = setInterval(() => {
      void this.tick()
    }, 250)
    this.seed()
    this.publish()
  }

  stop(): void {
    this.alive = false
    this.abort?.abort()
    if (this.pump) clearInterval(this.pump)
    if (this.timer) clearInterval(this.timer)
    if (this.micTimer) clearTimeout(this.micTimer)
  }

  snapshot(): OverlayState {
    const settings = this.deps.getSettings()
    return {
      speedLevel: settings.speedLevel,
      opacity: settings.opacity,
      fontSize: settings.fontSize,
      analyzing: this.analyzing,
      micLive: this.micLive,
      capturePaused: settings.capturePaused,
      speedFlash: this.speedFlash,
      micNote: this.micNote
    }
  }

  setMicLive(live: boolean): void {
    this.micLive = live
    this.publish()
  }

  setMicNote(note: string | null): void {
    this.micNote = note
    this.publish()
    if (this.micTimer) clearTimeout(this.micTimer)
    if (!note) return
    this.micTimer = setTimeout(() => {
      this.micNote = null
      this.publish()
    }, 2400)
  }

  noteSpeech(text: string): void {
    const clean = usableTranscript(text)
    if (!clean) return
    this.transcripts.push(clean)
    if (this.transcripts.length > 4) this.transcripts.shift()
    this.voicePending = true
  }

  requestScreen(): boolean {
    const settings = this.deps.getSettings()
    if (!this.alive || !settings.enabled || !settings.screenReaction || settings.capturePaused) return false
    this.capturePending = true
    return true
  }

  changeSpeed(direction: 'slower' | 'faster'): void {
    const next = stepSpeed(this.deps.getSettings().speedLevel, direction)
    this.deps.updateSettings({ speedLevel: next })
    this.speedFlash += 1
    this.publish()
  }

  toggleCapture(): void {
    this.setCapturePaused(!this.deps.getSettings().capturePaused)
  }

  setCapturePaused(paused: boolean): void {
    if (paused === this.deps.getSettings().capturePaused) return
    if (paused) {
      this.abort?.abort()
      this.capturePending = false
    }
    this.deps.updateSettings({ capturePaused: paused })
    this.publish()
  }

  private publish(): void {
    this.onState(this.snapshot())
  }

  private seed(): void {
    if (!this.deps.getSettings().enabled) return
    this.enqueue(makeFallbackMessages(3, Math.random, new Set()))
  }

  private enqueue(messages: ChatMessage[]): void {
    this.pending.push(...scheduleMessages(messages, this.deps.getSettings().speedLevel, Date.now()))
    this.pending.sort((a, b) => a.at - b.at)
    if (this.pending.length > 16) this.pending.length = 16
  }

  private idleFill(count = 2): void {
    const avoid = new Set(this.avoid.map((name) => name.toLowerCase()))
    this.enqueue(makeFallbackMessages(count, Math.random, avoid, this.transcripts.at(-1)))
  }

  private flush(): void {
    if (!this.deps.getSettings().enabled) return
    const { next, rest } = takeDue(this.pending, Date.now())
    this.pending = rest
    if (!next) return
    this.avoid.push(next.message.username)
    if (this.avoid.length > 40) this.avoid.shift()
    this.recentLines.push(`${next.message.username}: ${next.message.text}`)
    if (this.recentLines.length > 8) this.recentLines.shift()
    this.deps.sendMessage(next.message)
  }

  private async tick(): Promise<void> {
    if (!this.alive || this.busy) return
    const settings = this.deps.getSettings()
    if (!settings.enabled) return
    if (this.pending.length < 2) this.idleFill(2)
    const wantVoice = this.voicePending
    const wantCapture = this.capturePending && settings.screenReaction && !settings.capturePaused
    if (!wantVoice && !wantCapture) return
    this.voicePending = false
    this.capturePending = false
    const power = this.deps.power()
    const waitMs = nextWaitMs({
      captureIntervalSec: settings.captureIntervalSec,
      ecoMode: settings.ecoMode,
      idle: power.idle,
      onBattery: power.onBattery,
      backoffMs: this.backoffMs
    })
    await this.runCycle(wantVoice ? 'voice' : 'interval', waitMs, wantCapture)
  }

  private async runCycle(reason: 'interval' | 'voice', waitMs: number, captureNow = false): Promise<void> {
    this.busy = true
    const settings = this.deps.getSettings()
    const config = this.deps.config()
    const demo = process.env.CHATMODE_DEMO === '1'
    const canSend = demo || canReachService(settings, config)
    const captureScreen = captureNow && settings.screenReaction && !settings.capturePaused
    const controller = new AbortController()
    this.abort = controller
    try {
      let image: string | null = null
      let changed = !captureScreen
      if (captureScreen) {
        const frame = await this.deps.capture()
        if (controller.signal.aborted || !this.alive) return
        if (frame) {
          changed = !frameUnchanged(this.lastHash, frame.hash, settings.ecoMode ? 8 : 4)
          this.lastHash = frame.hash || this.lastHash
          if (changed) image = frame.jpegBase64
        }
      }
      const decision = shouldCallModel({
        reason,
        screenChanged: changed,
        underCap: underCallCap(this.deps.usage(), settings.maxCallsPerHour, Date.now()),
        hasService: canSend
      })
      if (decision !== 'ok') {
        this.idleFill(reason === 'voice' ? 2 : 3)
        return
      }
      let pcAudio: string[] = []
      if (settings.hearComputerAudio) {
        const heard = usableTranscript(await this.deps.pcAudio())
        if (controller.signal.aborted || !this.alive) return
        if (heard) pcAudio = [heard]
      }
      this.analyzing = reason === 'interval' || Boolean(image)
      this.publish()
      const plan = batchPlan(settings.ecoMode)
      const output = await produceReactions(
        {
          reason,
          screenEnabled: settings.screenReaction,
          capturePaused: settings.capturePaused,
          voiceEnabled: settings.voiceEnabled,
          proxyUrl: settings.proxyUrl,
          endpoint: config.endpoint,
          apiKey: config.apiKey,
          proxyToken: settings.proxyToken,
          model: config.model,
          imageBase64: image,
          transcripts: [...this.transcripts],
          pcAudio,
          recentLines: [...this.recentLines],
          avoidUsernames: [...this.avoid],
          speedLevel: settings.speedLevel,
          now: Date.now(),
          batchCount: plan.count,
          maxTokens: plan.maxTokens,
          backoffMs: this.backoffMs
        },
        {
          rng: Math.random,
          complete: (params) => {
            if (demo) return Promise.resolve({ ok: true, content: demoModelJson() })
            return requestCompletion({ ...params, signal: controller.signal })
          }
        }
      )
      if (controller.signal.aborted || !this.alive) return
      this.backoffMs = output.nextBackoffMs
      if (output.source === 'model') this.deps.setUsage(recordCall(this.deps.usage(), Date.now()))
      let scheduled = output.scheduled
      if (settings.ecoMode && output.source === 'model' && reason === 'interval') {
        scheduled = coverInterval(scheduled, Date.now(), waitMs)
      }
      if (scheduled.length) {
        this.pending.push(...scheduled)
        this.pending.sort((a, b) => a.at - b.at)
        if (this.pending.length > 16) this.pending.length = 16
      }
    } catch {
      this.deps.log('reaction cycle failed')
      this.backoffMs = nextBackoff(this.backoffMs, true)
    } finally {
      if (this.abort === controller) this.abort = null
      this.analyzing = false
      this.busy = false
      this.publish()
    }
  }
}
