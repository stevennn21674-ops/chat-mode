import { alertIntervalMs, alertReaction, allowSyntheticChat, rollAlert, sampleDonation, speechLine, type AlertDraft } from '../shared/alerts'
import { requestCompletion, type CompletionParams, type CompletionResult } from '../shared/ai-client'
import { batchPlan, callsInWindow, nextWaitMs, recordCall, shouldCallModel, underCallCap, type CallUsage } from '../shared/budget'
import {
  banViewer,
  bumpViewers,
  chatSlots,
  createCrowd,
  isBanned,
  markTalking,
  noteChatLine,
  noteScreen,
  tickCrowd,
  type CrowdViewer
} from '../shared/crowd'
import { badgeOf, customPromptBlock, type CustomCrowd } from '../shared/custom-viewers'
import { demoModelJson } from '../shared/demo'
import { displayChatText, isKidSafe } from '../shared/filter'
import type { LiveItem } from '../shared/live'
import { activityLines, allowAutoVision, detectGame, type ActivityEvent } from '../shared/screen-activity'
import { cleanOcrText, groundedLines } from '../shared/ocr-text'
import type { SceneCue } from '../shared/scene-cues'
import { buildVoiceReactions, sceneCaption, scheduleVoiceReactions, silenceLines, type VoiceScene } from '../shared/voice-react'
import { usableTranscript } from '../shared/speech'
import { frameUnchanged } from '../shared/frame-diff'
import { makeFallbackMessages } from '../shared/fallback'
import { brainDecision, paceFor, polishBrainLines, type BrainTurn } from '../shared/brain'
import { OVERLAY_AUDIO_ERROR } from '../shared/mic'
import { effectiveMode, perfProfile } from '../shared/performance'
import { echoWords, makeLocalMessages } from '../shared/local-chat'
import { ingest, lookupCandidate, referenceLine, compactContext, createKnowledge, type Knowledge } from '../shared/knowledge'
import { createMemory, detectIntent, noteText, recentTopics, type TermMemory } from '../shared/nlu'
import { buildMassBan, buildModeration, formatModCommand, mergeChatters, parseModCommand, resolveModTargets, spamBump, speakerOf, withoutChatter, type Chatter, type ModCommand } from '../shared/moderation'
import { produceReactions } from '../shared/pipeline'
import { coverInterval, scheduleMessages, takeDue, type ScheduledMessage } from '../shared/schedule'
import { canReachService, chatUsesService } from '../shared/settings'
import { screenChange, type ScreenCue } from '../shared/screen-cues'
import { stepSpeed } from '../shared/speed'
import type { AlertBanner, AppSettings, ChatMessage, OverlayState } from '../shared/types'
import { makeUsername } from '../shared/usernames'
import { colorFor } from '../shared/color'
import { nextBackoff } from '../shared/urls'
import type { ServiceConfig } from './service-config'

interface ControllerDeps {
  getSettings: () => AppSettings
  updateSettings: (patch: { speedLevel?: number; capturePaused?: boolean }) => void
  sendMessage: (message: ChatMessage) => void
  config: () => ServiceConfig
  capture: () => Promise<{ jpegBase64: string; hash: string; colors?: string[]; title?: string | null; scene?: SceneCue } | null>
  ocr?: (jpegBase64: string, hash: string) => Promise<string>
  complete?: (params: CompletionParams) => Promise<CompletionResult>
  pcAudio: () => Promise<{ text: string; loud: boolean }>
  usage: () => CallUsage
  setUsage: (usage: CallUsage) => void
  power: () => { idle: boolean; onBattery: boolean }
  log: (message: string) => void
  logVoice?: (line: string) => void
  offline?: () => boolean
  customCrowd?: () => CustomCrowd
  lookup?: (name: string) => Promise<string | null>
  brain?: {
    ready: () => boolean
    cpu: () => number | null
    generate: (turn: BrainTurn) => Promise<ChatMessage[] | null>
  }
  throttled?: () => boolean
  sendAlert?: (alert: AlertBanner) => void
  liveLines?: () => string[]
}

export class ChatController {
  private pending: ScheduledMessage[] = []
  private transcripts: string[] = []
  private pcLines: string[] = []
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
  private heardText: string | null = null
  private heardTimer: NodeJS.Timeout | null = null
  private micFault: string | null = null
  private audioDetailText = ''
  private faultTimer: NodeJS.Timeout | null = null
  private micLevel = 0
  private voiceFrame: { jpegBase64: string; hash: string; colors?: string[]; title?: string | null; scene?: SceneCue } | null = null
  private voiceFrameWait: Promise<void> | null = null
  private ocrTask: Promise<string> | null = null
  private screenText = ''
  private lastOcrHash = ''
  private lastSpeechAt = Date.now()
  private lastPromptAt = Date.now()
  private abort: AbortController | null = null
  private lastHash: string | null = null
  private onState: (state: OverlayState) => void = () => undefined
  private crowd = createCrowd(Math.random, Date.now())
  private lastText = new Map<string, string>()
  private extraSpam = new Map<string, number>()
  private crowdAt = 0
  private posters: Chatter[] = []
  private memory: TermMemory = createMemory()
  private knowledge: Knowledge = createKnowledge()
  private lastHeard = ''
  private loud = false
  private facts = new Map<string, string>()
  private looked = new Set<string>()
  private brainAt = 0
  private brainBusy = false
  private windowTitle = ''
  private activity: ActivityEvent | null = null
  private nextAlertAt = 0
  private liveActive = false
  private autoShots: number[] = []

  constructor(private deps: ControllerDeps) {}

  start(onState: (state: OverlayState) => void): void {
    this.onState = onState
    this.pump = setInterval(() => this.flush(), 80)
    this.timer = setInterval(() => {
      void this.tick()
    }, 250)
    this.syncCustom()
    this.seed()
    this.nextAlertAt = Date.now() + 8000
    this.publish()
  }

  stop(): void {
    this.alive = false
    this.abort?.abort()
    if (this.pump) clearInterval(this.pump)
    if (this.timer) clearInterval(this.timer)
    if (this.micTimer) clearTimeout(this.micTimer)
    if (this.heardTimer) clearTimeout(this.heardTimer)
    if (this.faultTimer) clearTimeout(this.faultTimer)
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
      micNote: this.micNote,
      heardText: settings.showHeard ? this.heardText : null,
      micFault: this.micFault,
      micLevel: this.micLive ? this.micLevel : 0,
      autoScroll: settings.autoScroll,
      viewerCount: this.crowd.count,
      debugText: settings.showDebugTranscript ? this.lastHeard : null
    }
  }

  setMicLive(live: boolean): void {
    this.micLive = live
    if (live) markTalking(this.crowd, Date.now())
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

  setMicLevel(level: number): void {
    const next = Math.max(0, Math.min(1, level))
    if (!this.micLive && next === 0) return
    if (Math.abs(next - this.micLevel) < 0.04 && next !== 0) return
    this.micLevel = next
    this.onState(this.snapshot())
  }

  audioDetail(): string {
    return this.audioDetailText
  }

  setMicFault(reason: string): void {
    const text = reason.trim().slice(0, 400) || 'microphone failed'
    this.audioDetailText = text
    this.micFault = OVERLAY_AUDIO_ERROR
    this.deps.logVoice?.(text)
    this.publish()
    if (this.faultTimer) clearTimeout(this.faultTimer)
    this.faultTimer = setTimeout(() => {
      this.micFault = null
      this.publish()
    }, 6500)
  }

  async prepareVoiceScreen(): Promise<void> {
    const run = this.captureForVoice()
    this.voiceFrameWait = run
    try {
      await run
    } finally {
      if (this.voiceFrameWait === run) this.voiceFrameWait = null
    }
  }

  async noteSpeech(text: string): Promise<void> {
    const raw = text.trim().slice(0, 400)
    if (raw.length < 2) {
      this.setMicFault('clip too short')
      return
    }
    const now = Date.now()
    this.lastHeard = raw.slice(0, 180)
    this.lastSpeechAt = now
    noteText(this.memory, raw, now)
    ingest(this.knowledge, raw, 'mic', now)
    const command = parseModCommand(raw)
    this.deps.logVoice?.(`${raw} => ${command ? formatModCommand(command) : 'none'}`)
    this.audioDetailText = ''
    this.showHeard(raw)
    if (command) {
      this.enforce(command)
      this.publish()
      return
    }
    markTalking(this.crowd, now)
    const clean = usableTranscript(raw)
    const remembered = clean || echoWords([raw]).join(' ')
    if (!remembered) {
      this.setMicFault('could not use that speech')
      return
    }
    const earlier = [...this.transcripts]
    this.transcripts.push(remembered)
    if (this.transcripts.length > 8) this.transcripts.shift()
    if (this.voiceFrameWait) await Promise.race([this.voiceFrameWait, delay(500)])
    if (this.ocrTask) {
      const heard = await Promise.race([this.ocrTask, delay(200).then(() => '')])
      const cleaned = cleanOcrText(heard)
      if (cleaned) this.screenText = cleaned
    }
    this.burstVoice(remembered, earlier)
    void this.maybeLookup()
    void this.enrichVoice()
    this.publish()
  }

  private showHeard(raw: string): void {
    if (!this.deps.getSettings().showHeard) {
      this.heardText = null
      return
    }
    const safe = raw.replace(/\s+/g, ' ').trim().slice(0, 160)
    if (!safe || !isKidSafe(safe)) return
    this.heardText = `heard: ${safe}`
    if (this.heardTimer) clearTimeout(this.heardTimer)
    this.heardTimer = setTimeout(() => {
      this.heardText = null
      this.publish()
    }, 6000)
    this.publish()
  }

  private async captureForVoice(): Promise<void> {
    const settings = this.deps.getSettings()
    if (!settings.lookAtScreenWhenTalking || settings.capturePaused) {
      this.voiceFrame = null
      return
    }
    try {
      const frame = await this.deps.capture()
      if (!frame) return
      this.voiceFrame = frame
      this.noteTitle(frame.title)
      if (frame.hash) this.lastHash = frame.hash
      if (!settings.readScreenText || !this.deps.ocr || !frame.hash || frame.hash === this.lastOcrHash) return
      const hash = frame.hash
      this.ocrTask = this.deps.ocr(frame.jpegBase64, hash).then((text) => {
        const cleaned = cleanOcrText(text)
        if (cleaned) {
          this.lastOcrHash = hash
          this.applyOcr(cleaned)
        }
        return cleaned
      }).catch(() => '')
    } catch {
      this.deps.log('voice screen capture failed')
    }
  }

  private voiceScene(): VoiceScene {
    const frame = this.voiceFrame
    const activity = this.activity
    const title = frame?.title || activity?.title || this.windowTitle || null
    const game = activity?.game || detectGame(title)
    const kind: VoiceScene['kind'] = activity
      ? activity.state === 'loading'
        ? 'loading'
        : activity.state === 'idle'
          ? 'menu'
          : activity.state === 'dark'
            ? 'dark'
            : activity.state === 'scare'
              ? 'cut'
              : 'gameplay'
      : frame?.scene?.uiLikely
        ? 'menu'
        : frame?.scene?.brightness === 'dark'
          ? 'dark'
          : 'unknown'
    const motion: VoiceScene['motion'] = activity
      ? activity.state === 'action' || activity.state === 'scare'
        ? 'fast'
        : activity.state === 'exploring'
          ? 'moving'
          : 'still'
      : 'still'
    const scene: VoiceScene = {
      title,
      game,
      colors: frame?.colors ?? [],
      kind,
      motion,
      ocr: this.screenText,
      textLike: Boolean(frame?.scene?.textLike || this.screenText),
      warm: Boolean(frame?.scene?.warm)
    }
    return scene
  }

  private burstVoice(transcript: string, earlier: string[]): void {
    const settings = this.deps.getSettings()
    const cpu = this.deps.brain?.cpu() ?? null
    const busyCpu = cpu !== null && cpu >= paceFor(settings.brainSpeed).cpuSkip
    const custom = (this.deps.customCrowd?.().viewers ?? []).filter((viewer) => viewer.active && !isBanned(this.crowd, viewer.username))
    const scene = settings.lookAtScreenWhenTalking ? this.voiceScene() : null
    const messages = buildVoiceReactions({
      transcript,
      earlier,
      scene,
      rng: Math.random,
      avoid: new Set(this.avoid.map((name) => name.toLowerCase())),
      roster: this.crowd.viewers
        .filter((viewer) => !isBanned(this.crowd, viewer.name))
        .map((viewer) => ({ name: viewer.name, badge: viewer.badge, color: viewer.color })),
      custom,
      now: Date.now(),
      busyCpu
    })
    this.pushPending(scheduleVoiceReactions(messages, Date.now()), true)
  }

  private applyOcr(text: string): void {
    this.screenText = text
    const now = Date.now()
    noteText(this.memory, text, now)
    ingest(this.knowledge, text, 'screen', now)
    if (now - this.lastSpeechAt > 20_000 && !this.capturePending) return
    const scene = this.voiceScene()
    const lines = groundedLines({ ocr: scene.ocr, colors: scene.colors, game: scene.game, kind: scene.kind }).filter(
      (line) => !this.pending.some((item) => item.message.text.toLowerCase() === line.toLowerCase())
    )
    if (!lines.length) return
    const avoid = new Set(this.avoid.map((name) => name.toLowerCase()))
    const messages = lines.slice(0, 2).map((line, index) => {
      const name = makeUsername(Math.random, avoid)
      avoid.add(name.toLowerCase())
      return {
        id: `vox-${now}-ocr${index}`,
        username: name,
        badge: null,
        color: colorFor(name),
        text: line,
        kind: 'chat' as const
      }
    })
    this.pushPending(messages.map((message, index) => ({ at: now + 500 + index * 900, message })), true)
    this.publish()
  }

  private async enrichVoice(): Promise<void> {
    if (!this.alive || this.busy || this.brainBusy) return
    const settings = this.deps.getSettings()
    const demo = process.env.CHATMODE_DEMO === '1'
    const scene = this.voiceScene()
    if (!this.deps.offline?.() && chatUsesService(settings.aiMode, demo)) {
      const config = this.deps.config()
      const can = demo || canReachService(settings, config)
      const under = underCallCap(this.deps.usage(), settings.maxCallsPerHour, Date.now())
      if (!can || !under) return
      this.busy = true
      this.capturePending = false
      try {
        const image = settings.lookAtScreenWhenTalking && !settings.capturePaused ? this.voiceFrame?.jpegBase64 ?? null : null
        const output = await produceReactions(
          {
            reason: 'voice',
            screenEnabled: settings.screenReaction,
            capturePaused: settings.capturePaused,
            voiceEnabled: true,
            proxyUrl: settings.proxyUrl,
            endpoint: config.endpoint,
            apiKey: config.apiKey,
            proxyToken: settings.proxyToken,
            model: config.model,
            imageBase64: image,
            transcripts: [...this.transcripts],
            pcAudio: [...this.pcLines],
            recentLines: [...this.recentLines],
            avoidUsernames: [...this.avoid],
            context: [compactContext(this.knowledge, Date.now()), sceneCaption(scene) ? `Local screen cues: ${sceneCaption(scene)}` : ''].filter(Boolean).join('\n'),
            customBlock: customPromptBlock(this.deps.customCrowd?.().viewers ?? [], this.deps.customCrowd?.().randomNames ?? []),
            speedLevel: settings.speedLevel,
            now: Date.now(),
            batchCount: 5,
            maxTokens: 320,
            backoffMs: 0,
            voiceTurn: true,
            seenText: this.screenText
          },
          {
            rng: Math.random,
            complete: (params) => {
              if (demo) return Promise.resolve({ ok: true, content: demoModelJson() })
              if (this.deps.complete) return this.deps.complete(params)
              return requestCompletion(params)
            }
          }
        )
        if (!this.alive) return
        if (output.source === 'model') {
          this.deps.setUsage(recordCall(this.deps.usage(), Date.now()))
          const lines = output.scheduled.map((item) => item.message).filter((message) => message.kind === 'chat')
          if (lines.length) this.adoptModelLines(lines)
        }
      } catch {
        this.deps.log('voice reaction failed')
      } finally {
        this.busy = false
        this.publish()
      }
      return
    }
    if (!this.holdBrain(settings)) return
    const cpu = this.deps.brain?.cpu() ?? null
    const busyCpu = cpu !== null && cpu >= paceFor(settings.brainSpeed).cpuSkip
    if (busyCpu || !this.deps.brain?.ready()) return
    const decision = brainDecision({
      enabled: true,
      ready: true,
      cpuPercent: cpu,
      lastAt: this.brainAt,
      now: Date.now(),
      pace: paceFor(settings.brainSpeed),
      force: true,
      throttled: this.deps.throttled?.() ?? false
    })
    if (decision !== 'run') return
    this.brainBusy = true
    this.brainAt = Date.now()
    try {
      const messages = await this.deps.brain.generate(this.brainTurn(scene.title))
      if (!this.alive || !this.holdBrain(this.deps.getSettings())) return
      const polished = messages?.length ? polishBrainLines(messages, this.recentLines, this.allowedBlob()) : []
      if (polished.length) this.adoptModelLines(polished)
    } catch {
      this.deps.log('voice brain failed')
    } finally {
      this.brainBusy = false
      this.publish()
    }
  }

  private adoptModelLines(lines: ChatMessage[]): void {
    const now = Date.now()
    const future = this.pending.filter((item) => item.message.id.startsWith('vox-') && item.at > now + 1400)
    let used = 0
    for (const item of future) {
      const line = lines[used]
      if (!line) break
      used += 1
      item.message = { ...item.message, username: line.username, badge: line.badge, color: line.color, text: line.text }
    }
    const extra = lines.slice(used, used + 3)
    extra.forEach((message, index) => {
      this.pending.push({ at: now + 1600 + index * 1600, message: { ...message, id: `vox-${now}-m${index}` } })
    })
    this.pending.sort((a, b) => a.at - b.at)
    this.trimPending(true)
  }

  private maybePrompt(): void {
    if (!this.allowFake() || this.micLive) return
    const now = Date.now()
    if (now - this.lastSpeechAt < 55_000 || now - this.lastPromptAt < 70_000 || this.pending.length > 4) return
    const game = this.activity?.game ?? detectGame(this.windowTitle)
    const avoid = new Set(this.avoid.map((name) => name.toLowerCase()))
    const messages = silenceLines(game).slice(0, 2).map((text, index) => {
      const username = makeUsername(Math.random, avoid)
      avoid.add(username.toLowerCase())
      return {
        id: `prompt-${now}-${index}`,
        username,
        badge: index === 0 ? ('mod' as const) : null,
        color: colorFor(username),
        text,
        kind: 'chat' as const
      }
    })
    this.pushPending(scheduleMessages(messages, this.deps.getSettings().speedLevel, now), false)
    this.lastPromptAt = now
  }

  async listenAmbient(): Promise<void> {
    if (!this.alive || this.busy || this.brainBusy) return
    const settings = this.deps.getSettings()
    if (!settings.enabled || !this.allowPc(settings)) return
    this.busy = true
    try {
      const before = this.pcLines.at(-1) ?? ''
      const heard = await this.heardAudio(settings)
      if (!heard.length && !this.loud) return
      if (heard[0] === before && !this.loud) return
      if (!this.holdBrain(settings)) {
        const avoid = new Set(this.avoid.map((name) => name.toLowerCase()))
        this.enqueue(this.localBatch(2, avoid, null))
      }
      void this.maybeLookup()
      this.publish()
    } catch {
      this.deps.log('ambient audio failed')
    } finally {
      this.busy = false
    }
  }

  requestScreen(): boolean {
    const settings = this.deps.getSettings()
    if (!this.alive || !settings.enabled || !settings.screenReaction || settings.capturePaused) return false
    this.capturePending = true
    return true
  }

  setLiveActive(active: boolean): void {
    this.liveActive = active
  }

  noteActivity(event: ActivityEvent): void {
    this.activity = event
    const now = event.at || Date.now()
    noteText(this.memory, event.detail, now)
    ingest(this.knowledge, event.detail, 'screen', now)
    if (event.game) noteText(this.memory, event.game, now)
    if (this.deps.getSettings().enabled) {
      const text = activityLines(event.state, event.game)[0]
      const speaker = this.crowd.viewers.find((viewer) => !isBanned(this.crowd, viewer.name))
      if (text && speaker) {
        this.enqueue([
          {
            id: `act-${now}`,
            username: speaker.name,
            badge: speaker.badge,
            color: speaker.color,
            text,
            kind: 'chat'
          }
        ])
      }
    }
    if (event.big && this.allowFake()) this.requestAutoVision()
    this.publish()
  }

  acceptLive(item: LiveItem): void {
    const settings = this.deps.getSettings()
    if (!settings.enabled) return
    const text = displayChatText(item.message.text, settings.hideBadWords)
    const username = displayChatText(item.message.username, settings.hideBadWords) ?? 'viewer'
    if (!text) return
    const message: ChatMessage = { ...item.message, text, username }
    const now = Date.now()
    noteText(this.memory, `${username} ${text}`, now)
    ingest(this.knowledge, `${username}: ${text}`, 'chat', now)
    if (item.alert) {
      this.showAlert(
        {
          message,
          reactions: [],
          viewerBump: item.bump,
          sound: settings.alertSound,
          speak: speechLine(message, settings.alertTts)
        },
        true
      )
      const speaker = this.crowd.viewers.find((viewer) => !isBanned(this.crowd, viewer.name))
      const text = alertReaction(message.kind, Math.random)
      if (speaker && text) {
        this.enqueue([
          {
            id: `live-react-${now}`,
            username: speaker.name,
            badge: speaker.badge,
            color: speaker.color,
            text,
            kind: 'chat'
          }
        ])
      }
      return
    }
    this.recentLines.push(`${username}: ${text}`)
    if (this.recentLines.length > 8) this.recentLines.shift()
    this.commit(message)
  }

  testDonation(): void {
    const settings = this.deps.getSettings()
    this.showAlert(sampleDonation(settings.alertCurrency, settings.alertSound, settings.alertTts), true)
  }

  private allowFake(): boolean {
    return allowSyntheticChat(this.deps.getSettings().chatMix, this.liveActive)
  }

  private isAlert(kind: ChatMessage['kind']): boolean {
    return kind === 'donation' || kind === 'sub' || kind === 'bits' || kind === 'gift' || kind === 'raid'
  }

  private allowedBlob(): string {
    return [...this.transcripts, ...this.pcLines, this.windowTitle, this.activity?.detail ?? '', this.activity?.game ?? '', ...this.recentLines, this.memory.joke].join(' ')
  }

  private requestAutoVision(): void {
    const settings = this.deps.getSettings()
    const now = Date.now()
    this.autoShots = this.autoShots.filter((stamp) => now - stamp < 3_600_000)
    if (!allowAutoVision({
      aiMode: settings.aiMode,
      autoVision: settings.autoVision,
      offline: this.deps.offline?.() ?? false,
      big: true,
      usedThisHour: this.autoShots.length,
      cap: settings.autoVisionPerHour,
      serviceCalls: callsInWindow(this.deps.usage(), now),
      serviceCap: settings.maxCallsPerHour,
      reserveForVoice: settings.lookAtScreenWhenTalking && settings.voiceEnabled
    })) return
    this.autoShots.push(now)
    this.capturePending = true
  }

  private maybeAlert(now: number): void {
    const settings = this.deps.getSettings()
    if (!settings.enabled || !settings.alertsEnabled || !this.allowFake()) return
    if (now < this.nextAlertAt) return
    this.nextAlertAt = now + alertIntervalMs(settings.alertFrequency, Math.random)
    this.showAlert(
      rollAlert({
        min: settings.alertMin,
        max: settings.alertMax,
        currency: settings.alertCurrency,
        sound: settings.alertSound,
        tts: settings.alertTts,
        avoid: new Set(this.avoid.map((name) => name.toLowerCase())),
        now
      }),
      false
    )
  }

  private showAlert(draft: AlertDraft, force: boolean): void {
    const settings = this.deps.getSettings()
    if (!force && !settings.alertsEnabled) return
    if (!isKidSafe(draft.message.text) || !isKidSafe(draft.message.username)) return
    bumpViewers(this.crowd, draft.viewerBump, Date.now())
    this.recentLines.push(`${draft.message.username}: ${draft.message.text}`)
    if (this.recentLines.length > 8) this.recentLines.shift()
    noteText(this.memory, `${draft.message.username} ${draft.message.amount ?? ''} ${draft.message.text}`, Date.now())
    this.deps.sendMessage(draft.message)
    this.deps.sendAlert?.({
      kind: draft.message.kind,
      username: draft.message.username,
      amount: draft.message.amount ?? '',
      text: draft.message.text,
      sound: draft.sound,
      volume: settings.alertVolume,
      speak: settings.alertTts ? draft.speak : null
    })
    if (draft.reactions.length && this.allowFake()) this.enqueue(draft.reactions)
    this.publish()
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
    this.idleFill(3)
  }

  private enqueue(messages: ChatMessage[], spreadMs = 0): void {
    const now = Date.now()
    const scheduled = scheduleMessages(messages, this.deps.getSettings().speedLevel, now)
    this.pushPending(spreadMs > 0 ? coverInterval(scheduled, now, spreadMs) : scheduled, false)
  }

  private pushPending(items: ScheduledMessage[], voice: boolean): void {
    this.pending.push(...items)
    this.pending.sort((a, b) => a.at - b.at)
    this.trimPending(voice)
  }

  private trimPending(voice: boolean): void {
    const cap = voice ? 24 : 16
    while (this.pending.length > cap) {
      const drop = voice ? this.pending.findIndex((item) => !item.message.id.startsWith('vox-')) : 0
      this.pending.splice(drop < 0 ? 0 : drop, 1)
    }
  }

  private localBatch(count: number, avoid: Set<string>, screen: ScreenCue | null): ChatMessage[] {
    this.syncCustom()
    const custom = this.deps.customCrowd?.() ?? { viewers: [], randomNames: [] }
    const recentNames = this.recentLines.map((line) => speakerOf(line)).filter((name) => name.length > 2)
    const heard = [this.lastHeard, this.pcLines.at(-1) ?? '', screen?.title ?? '', this.activity?.game ?? ''].filter(Boolean).join(' ')
    const intent = detectIntent(heard, {
      loud: this.loud,
      names: [...this.crowd.viewers.map((viewer) => viewer.name), ...custom.viewers.map((viewer) => viewer.username), ...recentNames]
    })
    const guided = intent.intent === 'question' || intent.intent === 'ask-chat' ? Math.max(count, 3) : count
    return makeLocalMessages({
      count: guided,
      rng: Math.random,
      avoid,
      transcripts: [...this.transcripts, ...recentTopics(this.memory, Date.now()).slice(0, 6)],
      pcAudio: [...this.pcLines],
      recentLines: [...this.recentLines],
      screen,
      boredom: this.crowd.boredom,
      roster: this.crowd.viewers
        .filter((viewer) => !isBanned(this.crowd, viewer.name))
        .map((viewer) => ({
          name: viewer.name,
          badge: viewer.badge,
          color: viewer.color
        })),
      custom: custom.viewers.filter((viewer) => viewer.active && !isBanned(this.crowd, viewer.username)),
      randomNames: custom.randomNames,
      intent: intent.intent,
      focus: intent.focus,
      joke: this.memory.joke,
      fact: [...this.facts.values()].at(-1),
      knowledgeLine: referenceLine(this.knowledge, Math.random) ?? undefined,
      now: Date.now(),
      screenText: this.screenText,
      activity:
        this.activity && Date.now() - this.activity.at < 12_000
          ? { state: this.activity.state, game: this.activity.game, at: this.activity.at }
          : null
    })
  }

  private idleFill(count = 2): void {
    if (!this.allowFake()) return
    const avoid = new Set(this.avoid.map((name) => name.toLowerCase()))
    const settings = this.deps.getSettings()
    if (!chatUsesService(settings.aiMode, process.env.CHATMODE_DEMO === '1')) {
      if (this.holdBrain(settings)) {
        const decision = this.brainGate(settings)
        if (decision === 'wait') return
        if (decision === 'run') {
          void this.fillFromBrain(count, null)
          return
        }
      }
      this.enqueue(this.localBatch(count, avoid, null))
      return
    }
    this.enqueue(makeFallbackMessages(count, Math.random, avoid, this.transcripts.at(-1)))
  }

  private commit(message: ChatMessage): void {
    if (message.kind === 'chat' && isBanned(this.crowd, message.username)) return
    if (message.kind === 'chat') {
      this.avoid.push(message.username)
      if (this.avoid.length > 40) this.avoid.shift()
      this.recentLines.push(`${message.username}: ${message.text}`)
      if (this.recentLines.length > 8) this.recentLines.shift()
      this.rememberSpam(message)
      this.rememberPoster(message)
      noteChatLine(this.crowd, message.text)
    }
    this.deps.sendMessage(message)
    if (!this.isAlert(message.kind) || !this.deps.getSettings().alertsEnabled) return
    const settings = this.deps.getSettings()
    bumpViewers(this.crowd, 2, Date.now())
    this.deps.sendAlert?.({
      kind: message.kind,
      username: message.username,
      amount: message.amount ?? '',
      text: message.text,
      sound: settings.alertSound,
      volume: settings.alertVolume,
      speak: null
    })
  }

  private rememberPoster(message: ChatMessage): void {
    const key = message.username.toLowerCase()
    const viewer = this.crowd.viewers.find((item) => item.name.toLowerCase() === key)
    this.posters = this.posters.filter((poster) => poster.name.toLowerCase() !== key)
    this.posters.push({
      name: message.username,
      spam: Math.max(viewer?.spam ?? 0, this.extraSpam.get(key) ?? 0),
      recentIndex: this.posters.length,
      mod: message.badge === 'mod' || viewer?.badge === 'mod'
    })
    if (this.posters.length > 40) this.posters.shift()
    this.posters = this.posters.map((poster, index) => ({ ...poster, recentIndex: index }))
  }

  private rememberSpam(message: ChatMessage): void {
    const key = message.username.toLowerCase()
    const bump = spamBump(this.lastText.get(key), message.text)
    this.lastText.set(key, message.text.trim().toLowerCase())
    if (!bump) return
    const viewer = this.crowd.viewers.find((item) => item.name.toLowerCase() === key)
    if (viewer) viewer.spam += bump
    else this.extraSpam.set(key, (this.extraSpam.get(key) ?? 0) + bump)
  }

  private chatters(): Chatter[] {
    const custom = this.deps.customCrowd?.().viewers ?? []
    return mergeChatters([
      this.posters,
      this.recentLines.map((line, index) => {
        const name = speakerOf(line)
        const key = name.toLowerCase()
        const viewer = this.crowd.viewers.find((item) => item.name.toLowerCase() === key)
        return {
          name,
          spam: Math.max(viewer?.spam ?? 0, this.extraSpam.get(key) ?? 0),
          recentIndex: index,
          mod: viewer?.badge === 'mod'
        }
      }),
      this.crowd.viewers.map((viewer) => ({
        name: viewer.name,
        spam: viewer.spam,
        recentIndex: -1,
        mod: viewer.badge === 'mod'
      })),
      custom.filter((viewer) => viewer.active).map((viewer) => ({
        name: viewer.username,
        spam: 0,
        recentIndex: -1,
        mod: viewer.role === 'mod'
      }))
    ])
  }

  private syncCustom(): void {
    const custom = this.deps.customCrowd?.().viewers ?? []
    for (const viewer of custom) {
      if (!viewer.active || isBanned(this.crowd, viewer.username)) continue
      const key = viewer.username.toLowerCase()
      const existing = this.crowd.viewers.find((item) => item.name.toLowerCase() === key)
      const badge = badgeOf(viewer.role)
      if (existing) {
        existing.badge = badge
        existing.color = viewer.color
        continue
      }
      if (this.crowd.viewers.length >= 22) {
        const drop = this.crowd.viewers.find((item) => item.badge !== 'mod' && !custom.some((person) => person.username.toLowerCase() === item.name.toLowerCase()))
        if (drop) this.crowd.viewers = this.crowd.viewers.filter((item) => item !== drop)
      }
      this.crowd.viewers.push({
        name: viewer.username,
        badge,
        color: viewer.color,
        engagement: viewer.presence / 100,
        spam: 0
      })
    }
  }

  private modSpeaker(except?: string | null): CrowdViewer {
    this.syncCustom()
    const skip = except?.toLowerCase() ?? ''
    const customMod = (this.deps.customCrowd?.().viewers ?? []).find(
      (viewer) => viewer.active && viewer.role === 'mod' && viewer.username.toLowerCase() !== skip && !isBanned(this.crowd, viewer.username)
    )
    if (customMod) {
      const found = this.crowd.viewers.find((viewer) => viewer.name.toLowerCase() === customMod.username.toLowerCase())
      if (found) return found
    }
    const mods = this.crowd.viewers.filter((viewer) => viewer.badge === 'mod' && viewer.name.toLowerCase() !== skip)
    if (mods.length) return mods[Math.floor(Math.random() * mods.length)] ?? mods[0]
    const avoid = new Set(this.crowd.viewers.map((viewer) => viewer.name.toLowerCase()))
    const name = makeUsername(Math.random, avoid)
    const viewer: CrowdViewer = { name, badge: 'mod', color: colorFor(name), engagement: 0.9, spam: 0 }
    this.crowd.viewers.push(viewer)
    return viewer
  }

  private enforce(command: ModCommand | null): void {
    if (!command) return
    this.syncCustom()
    let targets = resolveModTargets(command, this.chatters())
    if (command.target === 'everyone' && targets.length === 0) {
      targets = this.crowd.viewers.filter((viewer) => viewer.badge !== 'mod').map((viewer) => viewer.name).slice(0, 12)
    }
    const mod = this.modSpeaker(targets[0] ?? null)
    for (const target of targets) {
      const key = target.toLowerCase()
      this.pending = this.pending.filter((item) => item.message.username.toLowerCase() !== key)
      this.recentLines = withoutChatter(this.recentLines, target)
      this.posters = this.posters.filter((poster) => poster.name.toLowerCase() !== key)
      this.extraSpam.delete(key)
      this.lastText.delete(key)
      banViewer(this.crowd, target)
    }
    const built = targets.length > 1
      ? buildMassBan({ targets, modName: mod.name, modColor: mod.color, rng: Math.random, now: Date.now() })
      : buildModeration({ target: targets[0] ?? null, modName: mod.name, modColor: mod.color, rng: Math.random, now: Date.now() })
    for (const message of built) this.commit(message)
  }

  private flush(): void {
    if (!this.deps.getSettings().enabled) return
    const { next, rest } = takeDue(this.pending, Date.now())
    this.pending = rest
    if (!next) return
    if (next.message.kind === 'chat' && isBanned(this.crowd, next.message.username)) return
    this.commit(next.message)
  }

  private advanceCrowd(): void {
    const now = Date.now()
    if (now - this.crowdAt < 3000) return
    this.crowdAt = now
    const before = this.crowd.count
    const events = tickCrowd(this.crowd, {
      now,
      idle: this.deps.power().idle,
      micLive: this.micLive,
      rng: Math.random
    })
    for (const event of events) {
      if (event.type !== 'leave' || !event.text) continue
      this.enqueue([
        {
          id: `${now}-${event.name}`,
          username: event.name,
          badge: event.badge,
          color: event.color,
          text: event.text,
          kind: 'chat'
        }
      ])
    }
    if (events.length || this.crowd.count !== before) this.publish()
  }

  private async tick(): Promise<void> {
    if (!this.alive || this.busy || this.brainBusy) return
    const settings = this.deps.getSettings()
    if (!settings.enabled) return
    this.maybeAlert(Date.now())
    this.maybePrompt()
    this.advanceCrowd()
    const slots = chatSlots(this.crowd)
    const wantVoice = this.voicePending
    const wantCapture = this.capturePending && settings.screenReaction && !settings.capturePaused
    const brainHeld = this.holdBrain(settings)
    if (!brainHeld) {
      if (slots > 1 && this.pending.length < 2) this.idleFill(2)
      else if (slots === 1 && this.pending.length < 1) this.idleFill(1)
    }
    if (!wantVoice && !wantCapture) {
      if (brainHeld) {
        if (slots > 1 && this.pending.length < 2) this.idleFill(2)
        else if (slots === 1 && this.pending.length < 1) this.idleFill(1)
      }
      return
    }
    this.voicePending = false
    this.capturePending = false
    if (this.deps.offline?.() || !chatUsesService(settings.aiMode, process.env.CHATMODE_DEMO === '1')) {
      await this.runLocal(wantVoice, wantCapture)
      return
    }
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

  private rememberPc(text: string): void {
    if (!text) return
    this.pcLines.push(text)
    if (this.pcLines.length > 3) this.pcLines.shift()
  }

  private allowPc(settings: AppSettings): boolean {
    if (!settings.hearComputerAudio) return false
    return perfProfile(effectiveMode(settings.performanceMode, this.deps.throttled?.() ?? false)).loopback
  }

  private async heardAudio(settings: AppSettings): Promise<string[]> {
    if (!this.allowPc(settings)) return []
    const clip = await this.deps.pcAudio()
    this.loud = clip.loud
    const raw = clip.text.trim().slice(0, 400)
    if (raw && raw === this.pcLines.at(-1) && !clip.loud) return []
    const now = Date.now()
    if (raw) {
      noteText(this.memory, raw, now)
      ingest(this.knowledge, raw, 'pc', now)
      this.lastHeard = raw.slice(0, 180)
    }
    const heard = usableTranscript(raw)
    const local = this.deps.offline?.() || !chatUsesService(settings.aiMode, process.env.CHATMODE_DEMO === '1')
    const text = heard || (local ? echoWords([raw]).join(' ') : '')
    if (!text) return []
    this.rememberPc(text)
    return [text]
  }

  private noteTitle(title: string | null | undefined): void {
    if (!title) return
    this.windowTitle = title.slice(0, 120)
    const now = Date.now()
    noteText(this.memory, title, now)
    ingest(this.knowledge, title, 'title', now)
  }

  private holdBrain(settings: AppSettings): boolean {
    return Boolean(this.deps.brain && settings.localBrain && !settings.aiMode && process.env.CHATMODE_DEMO !== '1')
  }

  private brainGate(settings: AppSettings): 'run' | 'wait' | 'fallback' {
    return brainDecision({
      enabled: this.holdBrain(settings),
      ready: this.deps.brain?.ready() ?? false,
      cpuPercent: this.deps.brain?.cpu() ?? null,
      lastAt: this.brainAt,
      now: Date.now(),
      pace: paceFor(settings.brainSpeed),
      throttled: this.deps.throttled?.() ?? false
    })
  }

  private brainTurn(screenTitle: string | null): BrainTurn {
    const custom = this.deps.customCrowd?.() ?? { viewers: [], randomNames: [] }
    return {
      transcripts: [...this.transcripts],
      pcAudio: [...this.pcLines],
      recentLines: [...this.recentLines],
      windowTitle: screenTitle || this.windowTitle || null,
      context: compactContext(this.knowledge, Date.now()),
      customBlock: customPromptBlock(
        custom.viewers.filter((viewer) => viewer.active && !isBanned(this.crowd, viewer.username)),
        custom.randomNames
      ),
      boredom: this.crowd.boredom,
      viewerCount: this.crowd.count,
      avoid: [...this.avoid],
      now: Date.now(),
      rng: Math.random,
      activity: this.activity?.detail ?? '',
      liveLines: this.deps.liveLines?.() ?? this.recentLines.slice(-4),
      joke: this.memory.joke,
      screenText: this.screenText,
      sceneCaption: sceneCaption(this.voiceScene())
    }
  }

  private async fillFromBrain(count: number, screen: ScreenCue | null): Promise<void> {
    if (this.brainBusy || this.busy) return
    const settings = this.deps.getSettings()
    if (!this.holdBrain(settings)) return
    this.brainBusy = true
    this.brainAt = Date.now()
    try {
      const messages = await this.deps.brain?.generate(this.brainTurn(screen?.title ?? null))
      if (!this.alive || !this.holdBrain(this.deps.getSettings())) return
      const polished = messages?.length ? polishBrainLines(messages, this.recentLines, this.allowedBlob()) : []
      if (polished.length) this.enqueue(polished, paceFor(this.deps.getSettings().brainSpeed).intervalMs)
      else {
        const avoid = new Set(this.avoid.map((name) => name.toLowerCase()))
        this.enqueue(this.localBatch(count, avoid, screen))
      }
    } catch {
      if (!this.alive || !this.holdBrain(this.deps.getSettings())) return
      const avoid = new Set(this.avoid.map((name) => name.toLowerCase()))
      this.enqueue(this.localBatch(count, avoid, screen))
    } finally {
      this.brainBusy = false
      this.publish()
    }
  }

  private async maybeLookup(): Promise<void> {
    if (this.deps.getSettings().aiMode || this.deps.offline?.()) return
    const name = lookupCandidate(this.knowledge, this.looked)
    if (!name) return
    this.looked.add(name.toLowerCase())
    try {
      const fact = await this.deps.lookup?.(name)
      if (fact) this.facts.set(name.toLowerCase(), fact)
    } catch {
      // Lookups are optional.
    }
  }

  private async runLocal(voice: boolean, captureNow: boolean): Promise<void> {
    this.busy = true
    const settings = this.deps.getSettings()
    const controller = new AbortController()
    this.abort = controller
    try {
      let signal: ScreenCue | null = null
      if (captureNow && settings.screenReaction && !settings.capturePaused) {
        const frame = await this.deps.capture()
        if (controller.signal.aborted || !this.alive) return
        if (frame) {
          const change = screenChange(this.lastHash, frame.hash)
          this.lastHash = frame.hash || this.lastHash
          signal = { change, colors: frame.colors ?? [], title: frame.title ?? null }
          noteScreen(this.crowd, change, Date.now())
          this.noteTitle(signal.title)
          void this.maybeLookup()
          await this.readOcr(frame)
        }
      }
      if (this.allowPc(settings) && (voice || signal)) {
        if (controller.signal.aborted || !this.alive) return
        await this.heardAudio(settings)
      }
      const avoid = new Set(this.avoid.map((name) => name.toLowerCase()))
      const count = Math.max(2, Math.min(4, chatSlots(this.crowd) + 1))
      if (this.holdBrain(settings)) {
        const decision = this.brainGate(settings)
        if (decision === 'run') {
          this.brainAt = Date.now()
          const messages = await this.deps.brain?.generate(this.brainTurn(signal?.title ?? null))
          if (controller.signal.aborted || !this.alive) return
          const polished = messages?.length ? polishBrainLines(messages, this.recentLines, this.allowedBlob()) : []
          if (polished.length && this.holdBrain(this.deps.getSettings())) {
            this.enqueue(polished, paceFor(this.deps.getSettings().brainSpeed).intervalMs)
            this.publish()
            return
          }
        } else if (decision === 'wait' && this.pending.length >= 2) {
          this.publish()
          return
        }
      }
      this.enqueue(this.localBatch(count, avoid, signal))
      this.publish()
    } catch {
      this.deps.log('local chat failed')
    } finally {
      if (this.abort === controller) this.abort = null
      this.busy = false
      this.publish()
    }
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
          const amount = screenChange(this.lastHash, frame.hash)
          changed = !frameUnchanged(this.lastHash, frame.hash, settings.ecoMode ? 8 : 4)
          this.lastHash = frame.hash || this.lastHash
          noteScreen(this.crowd, amount, Date.now())
          this.noteTitle(frame.title)
          if (changed) image = frame.jpegBase64
          await this.readOcr(frame)
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
      if (this.allowPc(settings)) {
        pcAudio = await this.heardAudio(settings)
        if (controller.signal.aborted || !this.alive) return
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
          context: [compactContext(this.knowledge, Date.now()), this.activity ? `Screen activity: ${this.activity.detail}` : '', this.screenText ? `On-screen text: ${this.screenText}` : '']
            .filter(Boolean)
            .join('\n'),
          seenText: this.screenText,
          customBlock: customPromptBlock(this.deps.customCrowd?.().viewers ?? [], this.deps.customCrowd?.().randomNames ?? []),
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

  private async readOcr(frame: { jpegBase64: string; hash: string } | null): Promise<void> {
    if (!frame || !this.deps.getSettings().readScreenText || !this.deps.ocr) return
    if (frame.hash && frame.hash === this.lastOcrHash && this.screenText) return
    const task = this.deps
      .ocr(frame.jpegBase64, frame.hash)
      .then((text) => {
        const cleaned = cleanOcrText(text)
        if (cleaned) {
          this.lastOcrHash = frame.hash
          this.screenText = cleaned
        }
        return cleaned
      })
      .catch(() => '')
    await Promise.race([task, delay(900)])
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
