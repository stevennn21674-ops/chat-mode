import { requestCompletion } from '../shared/ai-client'
import { batchPlan, nextWaitMs, recordCall, shouldCallModel, underCallCap, type CallUsage } from '../shared/budget'
import {
  banViewer,
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
import { usableTranscript } from '../shared/speech'
import { frameUnchanged } from '../shared/frame-diff'
import { makeFallbackMessages } from '../shared/fallback'
import { echoWords, makeLocalMessages } from '../shared/local-chat'
import { ingest, lookupCandidate, referenceLine, compactContext, createKnowledge, type Knowledge } from '../shared/knowledge'
import { createMemory, detectIntent, noteText, recentTopics, type TermMemory } from '../shared/nlu'
import { buildMassBan, buildModeration, formatModCommand, mergeChatters, parseModCommand, resolveModTargets, spamBump, speakerOf, withoutChatter, type Chatter, type ModCommand } from '../shared/moderation'
import { produceReactions } from '../shared/pipeline'
import { coverInterval, scheduleMessages, takeDue, type ScheduledMessage } from '../shared/schedule'
import { canReachService, chatUsesService } from '../shared/settings'
import { screenChange, type ScreenCue } from '../shared/screen-cues'
import { stepSpeed } from '../shared/speed'
import type { AppSettings, ChatMessage, OverlayState } from '../shared/types'
import { makeUsername } from '../shared/usernames'
import { colorFor } from '../shared/color'
import { nextBackoff } from '../shared/urls'
import type { ServiceConfig } from './service-config'

interface ControllerDeps {
  getSettings: () => AppSettings
  updateSettings: (patch: { speedLevel?: number; capturePaused?: boolean }) => void
  sendMessage: (message: ChatMessage) => void
  config: () => ServiceConfig
  capture: () => Promise<{ jpegBase64: string; hash: string; colors?: string[]; title?: string | null } | null>
  pcAudio: () => Promise<{ text: string; loud: boolean }>
  usage: () => CallUsage
  setUsage: (usage: CallUsage) => void
  power: () => { idle: boolean; onBattery: boolean }
  log: (message: string) => void
  logVoice?: (line: string) => void
  offline?: () => boolean
  customCrowd?: () => CustomCrowd
  lookup?: (name: string) => Promise<string | null>
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

  constructor(private deps: ControllerDeps) {}

  start(onState: (state: OverlayState) => void): void {
    this.onState = onState
    this.pump = setInterval(() => this.flush(), 80)
    this.timer = setInterval(() => {
      void this.tick()
    }, 250)
    this.syncCustom()
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
      micNote: this.micNote,
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

  noteSpeech(text: string): void {
    const raw = text.trim().slice(0, 400)
    if (raw.length < 2) return
    const now = Date.now()
    this.lastHeard = raw.slice(0, 180)
    noteText(this.memory, raw, now)
    ingest(this.knowledge, raw, 'mic', now)
    const command = parseModCommand(raw)
    this.deps.logVoice?.(`${raw} => ${command ? formatModCommand(command) : 'none'}`)
    if (command) {
      this.enforce(command)
      this.publish()
      return
    }
    markTalking(this.crowd, now)
    const clean = usableTranscript(raw)
    const remembered = clean || (!this.deps.getSettings().aiMode ? echoWords([raw]).join(' ') : '')
    if (remembered) {
      this.transcripts.push(remembered)
      if (this.transcripts.length > 4) this.transcripts.shift()
      this.voicePending = true
    }
    void this.maybeLookup()
    this.publish()
  }

  async listenAmbient(): Promise<void> {
    if (!this.alive || this.busy) return
    const settings = this.deps.getSettings()
    if (!settings.enabled || !settings.hearComputerAudio) return
    this.busy = true
    try {
      const before = this.pcLines.at(-1) ?? ''
      const heard = await this.heardAudio(settings)
      if (!heard.length && !this.loud) return
      if (heard[0] === before && !this.loud) return
      const avoid = new Set(this.avoid.map((name) => name.toLowerCase()))
      this.enqueue(this.localBatch(2, avoid, null))
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

  private enqueue(messages: ChatMessage[]): void {
    this.pending.push(...scheduleMessages(messages, this.deps.getSettings().speedLevel, Date.now()))
    this.pending.sort((a, b) => a.at - b.at)
    if (this.pending.length > 16) this.pending.length = 16
  }

  private localBatch(count: number, avoid: Set<string>, screen: ScreenCue | null): ChatMessage[] {
    this.syncCustom()
    const custom = this.deps.customCrowd?.() ?? { viewers: [], randomNames: [] }
    const heard = [this.lastHeard, this.pcLines.at(-1) ?? '', screen?.title ?? ''].filter(Boolean).join(' ')
    const intent = detectIntent(heard, {
      loud: this.loud,
      names: [...this.crowd.viewers.map((viewer) => viewer.name), ...custom.viewers.map((viewer) => viewer.username)]
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
      now: Date.now()
    })
  }

  private idleFill(count = 2): void {
    const avoid = new Set(this.avoid.map((name) => name.toLowerCase()))
    const settings = this.deps.getSettings()
    if (!chatUsesService(settings.aiMode, process.env.CHATMODE_DEMO === '1')) {
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
    if (!this.alive || this.busy) return
    const settings = this.deps.getSettings()
    if (!settings.enabled) return
    this.advanceCrowd()
    const slots = chatSlots(this.crowd)
    if (slots > 1 && this.pending.length < 2) this.idleFill(2)
    else if (slots === 1 && this.pending.length < 1) this.idleFill(1)
    const wantVoice = this.voicePending
    const wantCapture = this.capturePending && settings.screenReaction && !settings.capturePaused
    if (!wantVoice && !wantCapture) return
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

  private async heardAudio(settings: AppSettings): Promise<string[]> {
    if (!settings.hearComputerAudio) return []
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
    const now = Date.now()
    noteText(this.memory, title, now)
    ingest(this.knowledge, title, 'title', now)
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
        }
      }
      if (settings.hearComputerAudio && (voice || signal)) {
        if (controller.signal.aborted || !this.alive) return
        await this.heardAudio(settings)
      }
      const avoid = new Set(this.avoid.map((name) => name.toLowerCase()))
      const count = Math.max(2, Math.min(4, chatSlots(this.crowd) + 1))
      this.enqueue(
        this.localBatch(count, avoid, signal)
      )
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
          context: compactContext(this.knowledge, Date.now()),
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
}
