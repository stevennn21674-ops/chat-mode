import { viewerBumpFor } from '../shared/alerts'
import {
  continuationFromHtml,
  parseInnertubeChat,
  parseOfficialChat,
  parseYoutubeTarget,
  reconnectDelay,
  shouldLink,
  twitchItem,
  videoIdFromUrl,
  type LiveItem
} from '../shared/live'
import type { AppSettings } from '../shared/types'

const INNERTUBE = {
  client: { clientName: 'WEB', clientVersion: '2.20251021.01.00', hl: 'en', gl: 'US' }
}

export class LiveChat {
  private twitchSocket: WebSocket | null = null
  private twitchTimer: NodeJS.Timeout | null = null
  private youtubeTimer: NodeJS.Timeout | null = null
  private twitchAttempt = 0
  private youtubeAttempt = 0
  private twitchChannel = ''
  private youtubeTarget = ''
  private twitchClosed = true
  private youtubeClosed = true
  private seen = new Set<string>()
  private parts: string[] = []

  constructor(
    private deps: {
      getSettings: () => AppSettings
      offline: () => boolean
      youtubeKey: () => string
      onItem: (item: LiveItem) => void
      onStatus: (text: string) => void
      onActive: (active: boolean) => void
      log: (message: string) => void
    }
  ) {}

  sync(): void {
    const settings = this.deps.getSettings()
    const offline = this.deps.offline()
    if (!settings.liveLink) {
      this.stopTwitch()
      this.stopYoutube()
      this.deps.onActive(false)
      this.deps.onStatus(offline ? 'Offline. Live chat stays disconnected.' : 'Disconnected.')
      return
    }
    if (offline) {
      this.stopTwitch()
      this.stopYoutube()
      this.deps.onActive(false)
      this.deps.onStatus('Offline, so live chat is paused. It retries when the connection returns.')
      return
    }
    const twitch = shouldLink({ offline, liveLink: true, target: settings.twitchChannel }) ? settings.twitchChannel : ''
    const youtube = shouldLink({ offline, liveLink: true, target: settings.youtubeLive }) ? settings.youtubeLive : ''
    if (twitch !== this.twitchChannel) this.startTwitch(twitch)
    else if (!twitch) this.stopTwitch()
    if (youtube !== this.youtubeTarget) this.startYoutube(youtube)
    else if (!youtube) this.stopYoutube()
    if (!twitch && !youtube) {
      this.deps.onActive(false)
      this.deps.onStatus('Add a Twitch channel or a YouTube live link, then connect.')
    }
  }

  stop(): void {
    this.stopTwitch()
    this.stopYoutube()
    this.deps.onActive(false)
  }

  private setActive(): void {
    const twitchUp = Boolean(this.twitchSocket && this.twitchSocket.readyState === WebSocket.OPEN)
    const youtubeUp = !this.youtubeClosed && Boolean(this.youtubeTarget)
    this.deps.onActive(twitchUp || youtubeUp)
  }

  private startTwitch(channel: string): void {
    this.stopTwitch()
    if (!channel) return
    this.twitchChannel = channel
    this.twitchClosed = false
    this.twitchAttempt = 0
    this.openTwitch()
  }

  private stopTwitch(): void {
    this.twitchClosed = true
    this.twitchChannel = ''
    if (this.twitchTimer) clearTimeout(this.twitchTimer)
    this.twitchTimer = null
    const socket = this.twitchSocket
    this.twitchSocket = null
    try {
      socket?.close()
    } catch {
      // The socket is already gone.
    }
  }

  private openTwitch(): void {
    const channel = this.twitchChannel
    if (!channel || this.twitchClosed) return
    this.deps.onStatus(`Twitch: connecting to #${channel}…`)
    let socket: WebSocket
    try {
      socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443')
    } catch {
      this.scheduleTwitch()
      return
    }
    this.twitchSocket = socket
    socket.addEventListener('open', () => {
      if (this.twitchSocket !== socket) return
      const nick = `justinfan${10000 + Math.floor(Math.random() * 89999)}`
      socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
      socket.send('PASS SCHMOOPIIE')
      socket.send(`NICK ${nick}`)
      socket.send(`JOIN #${channel}`)
      this.twitchAttempt = 0
      this.deps.onStatus(`Twitch: connected to #${channel}`)
      this.deps.log(`twitch joined #${channel}`)
      this.setActive()
    })
    socket.addEventListener('message', (event) => {
      const data = typeof event.data === 'string' ? event.data : ''
      for (const line of data.split(/\r?\n/)) {
        if (!line) continue
        if (line.startsWith('PING')) {
          socket.send(line.replace('PING', 'PONG'))
          continue
        }
        this.takeTwitch(line)
      }
    })
    socket.addEventListener('close', () => {
      if (this.twitchSocket === socket) this.twitchSocket = null
      this.setActive()
      if (!this.twitchClosed) this.scheduleTwitch()
    })
    socket.addEventListener('error', () => {
      this.deps.log('twitch chat connection failed')
    })
  }

  private scheduleTwitch(): void {
    if (this.twitchClosed || !this.twitchChannel) return
    const wait = reconnectDelay(this.twitchAttempt)
    this.twitchAttempt += 1
    this.deps.onStatus(`Twitch: reconnecting to #${this.twitchChannel}…`)
    if (this.twitchTimer) clearTimeout(this.twitchTimer)
    this.twitchTimer = setTimeout(() => this.openTwitch(), wait)
  }

  private takeTwitch(line: string): void {
    const settings = this.deps.getSettings()
    const item = twitchItem(line, Date.now(), Math.random, settings.hideBadWords)
    if (!item) return
    this.emit(item)
  }

  private startYoutube(target: string): void {
    this.stopYoutube()
    if (!target) return
    this.youtubeTarget = target
    this.youtubeClosed = false
    this.youtubeAttempt = 0
    void this.openYoutube()
  }

  private stopYoutube(): void {
    this.youtubeClosed = true
    this.youtubeTarget = ''
    if (this.youtubeTimer) clearTimeout(this.youtubeTimer)
    this.youtubeTimer = null
    this.setActive()
  }

  private async openYoutube(): Promise<void> {
    const target = this.youtubeTarget
    if (!target || this.youtubeClosed) return
    const parsed = parseYoutubeTarget(target)
    if (parsed.type === 'invalid' || parsed.type === 'empty') {
      this.deps.onStatus('YouTube: that link is not a video, channel, or @handle.')
      this.youtubeClosed = true
      return
    }
    this.deps.onStatus('YouTube: connecting…')
    const key = this.deps.youtubeKey().trim()
    try {
      if (key) {
        const official = await this.officialLoop(parsed, key)
        if (official) return
      }
      const videoId = parsed.type === 'video' ? parsed.id : await this.videoFromPage(parsed)
      if (!videoId) {
        this.deps.onStatus('YouTube: no live video was found. The unofficial page can break, or add a Data API key.')
        this.scheduleYoutube()
        return
      }
      const continuation = await this.chatContinuation(videoId)
      if (!continuation) {
        this.deps.onStatus('YouTube: the live chat token was missing. An API key in Settings is the stable option.')
        this.scheduleYoutube()
        return
      }
      this.youtubeAttempt = 0
      this.deps.onStatus('YouTube: reading live chat (unofficial). It can break without notice.')
      this.setActive()
      await this.pollInnertube(continuation)
    } catch {
      this.deps.log('youtube chat failed')
      this.scheduleYoutube()
    }
  }

  private scheduleYoutube(): void {
    if (this.youtubeClosed || !this.youtubeTarget) return
    const wait = reconnectDelay(this.youtubeAttempt)
    this.youtubeAttempt += 1
    this.deps.onStatus('YouTube: reconnecting…')
    if (this.youtubeTimer) clearTimeout(this.youtubeTimer)
    this.youtubeTimer = setTimeout(() => {
      void this.openYoutube()
    }, wait)
  }

  private async officialLoop(parsed: ReturnType<typeof parseYoutubeTarget>, key: string): Promise<boolean> {
    const chatId = await this.officialChatId(parsed, key)
    if (!chatId) return false
    this.youtubeAttempt = 0
    this.deps.onStatus('YouTube: connected with the Data API.')
    this.setActive()
    let page = ''
    while (!this.youtubeClosed && this.youtubeTarget) {
      const url = new URL('https://www.googleapis.com/youtube/v3/liveChat/messages')
      url.searchParams.set('liveChatId', chatId)
      url.searchParams.set('part', 'snippet,authorDetails')
      url.searchParams.set('key', key)
      if (page) url.searchParams.set('pageToken', page)
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!response.ok) return false
      const body: unknown = await response.json()
      const parsedPage = parseOfficialChat(body, Date.now(), Math.random, this.deps.getSettings().hideBadWords)
      for (const item of parsedPage.items) this.emit(item)
      page = parsedPage.continuation ?? ''
      await delay(parsedPage.waitMs)
    }
    return true
  }

  private async officialChatId(parsed: ReturnType<typeof parseYoutubeTarget>, key: string): Promise<string | null> {
    let videoId = parsed.type === 'video' ? parsed.id : ''
    if (!videoId && parsed.type === 'handle') {
      const channel = await this.apiGet('channels', { part: 'id', forHandle: parsed.handle, key })
      const channelId = firstStringId(channel)
      if (!channelId) return null
      const search = await this.apiGet('search', { part: 'snippet', channelId, eventType: 'live', type: 'video', key })
      videoId = firstVideoId(search) ?? ''
    }
    if (!videoId && parsed.type === 'channel') {
      const search = await this.apiGet('search', { part: 'snippet', channelId: parsed.id, eventType: 'live', type: 'video', key })
      videoId = firstVideoId(search) ?? ''
    }
    if (!videoId) return null
    const videos = await this.apiGet('videos', { part: 'liveStreamingDetails', id: videoId, key })
    return nestedString(videos, ['items', '0', 'liveStreamingDetails', 'activeLiveChatId'])
  }

  private async apiGet(path: string, query: Record<string, string>): Promise<unknown> {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return null
    return response.json()
  }

  private async videoFromPage(parsed: ReturnType<typeof parseYoutubeTarget>): Promise<string | null> {
    if (parsed.type === 'video') return parsed.id
    const handle = parsed.type === 'handle' ? `@${parsed.handle}` : parsed.type === 'channel' ? `channel/${parsed.id}` : ''
    if (!handle) return null
    const response = await fetch(`https://www.youtube.com/${handle}/live`, {
      redirect: 'follow',
      headers: { 'User-Agent': 'ChatMode/0.6.0' },
      signal: AbortSignal.timeout(8000)
    })
    const fromUrl = videoIdFromUrl(response.url)
    if (fromUrl) return fromUrl
    const html = await response.text()
    const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/)
    return match?.[1] ?? null
  }

  private async chatContinuation(videoId: string): Promise<string | null> {
    const response = await fetch(`https://www.youtube.com/live_chat?is_popout=1&v=${encodeURIComponent(videoId)}`, {
      headers: { 'User-Agent': 'ChatMode/0.6.0' },
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) return null
    return continuationFromHtml(await response.text())
  }

  private async pollInnertube(token: string): Promise<void> {
    let continuation: string | null = token
    while (!this.youtubeClosed && continuation && this.youtubeTarget) {
      const response = await fetch('https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ChatMode/0.6.0',
          Origin: 'https://www.youtube.com'
        },
        body: JSON.stringify({ context: { client: INNERTUBE.client }, continuation }),
        signal: AbortSignal.timeout(8000)
      })
      if (!response.ok) {
        this.scheduleYoutube()
        return
      }
      const page = parseInnertubeChat(await response.json(), Date.now(), Math.random, this.deps.getSettings().hideBadWords)
      for (const item of page.items) this.emit(item)
      continuation = page.continuation
      if (!continuation) {
        this.scheduleYoutube()
        return
      }
      await delay(page.waitMs)
    }
  }

  private emit(item: LiveItem): void {
    const key = `${item.message.username}:${item.message.kind}:${item.message.text}:${item.message.amount ?? ''}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    if (this.seen.size > 400) {
      const first = this.seen.values().next().value
      if (first) this.seen.delete(first)
    }
    if (item.alert) item.bump = viewerBumpFor(item.message.kind, numberFrom(item.message.amount), item.message.viewers ?? item.bump)
    this.deps.onItem(item)
    this.parts = [...this.parts, `${item.message.username}: ${item.message.text}`].slice(-6)
  }

  recent(): string[] {
    return [...this.parts]
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function numberFrom(amount: string | undefined): number {
  const match = amount?.replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function firstStringId(payload: unknown): string | null {
  const item = firstItem(payload)
  if (!item || typeof item !== 'object') return null
  const id = (item as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

function firstVideoId(payload: unknown): string | null {
  const item = firstItem(payload)
  if (!item || typeof item !== 'object') return null
  const id = (item as { id?: unknown }).id
  if (id && typeof id === 'object' && typeof (id as { videoId?: unknown }).videoId === 'string') return (id as { videoId: string }).videoId
  return null
}

function firstItem(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return null
  const items = (payload as { items?: unknown }).items
  return Array.isArray(items) ? items[0] : null
}

function nestedString(payload: unknown, path: string[]): string | null {
  let current: unknown = payload
  for (const key of path) {
    if (Array.isArray(current)) {
      current = current[Number(key)]
      continue
    }
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' ? current : null
}
