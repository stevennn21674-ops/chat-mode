import { colorFor } from './color'
import { displayChatText } from './filter'
import { makeId } from './ids'
import type { Badge, ChatMessage, MessageKind } from './types'

export interface LiveItem {
  message: ChatMessage
  alert: boolean
  bump: number
}

export function normalizeTwitchChannel(input: string): string {
  const name = input.trim().replace(/^#/, '').toLowerCase()
  return /^[a-z0-9_]{2,25}$/.test(name) ? name : ''
}

export function reconnectDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.min(Math.max(0, attempt), 5))
}

export function shouldLink(input: { offline: boolean; liveLink: boolean; target: string }): boolean {
  return input.liveLink && !input.offline && input.target.trim().length > 0
}

export type YoutubeTarget =
  | { type: 'video'; id: string }
  | { type: 'handle'; handle: string }
  | { type: 'channel'; id: string }
  | { type: 'empty' }
  | { type: 'invalid' }

const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/

export function parseYoutubeTarget(input: string): YoutubeTarget {
  const raw = input.trim()
  if (!raw) return { type: 'empty' }
  if (VIDEO_ID.test(raw)) return { type: 'video', id: raw }
  if (raw.startsWith('@')) {
    const handle = raw.slice(1).replace(/[^a-zA-Z0-9._-]/g, '')
    return handle ? { type: 'handle', handle } : { type: 'invalid' }
  }
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '')
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0] ?? ''
      return VIDEO_ID.test(id) ? { type: 'video', id } : { type: 'invalid' }
    }
    if (!host.endsWith('youtube.com')) return { type: 'invalid' }
    const watch = url.searchParams.get('v')
    if (watch && VIDEO_ID.test(watch)) return { type: 'video', id: watch }
    const parts = url.pathname.split('/').filter(Boolean)
    if ((parts[0] === 'live' || parts[0] === 'watch' || parts[0] === 'shorts') && parts[1] && VIDEO_ID.test(parts[1])) {
      return { type: 'video', id: parts[1] }
    }
    if (parts[0] === 'channel' && parts[1]?.startsWith('UC')) return { type: 'channel', id: parts[1] }
    if (parts[0]?.startsWith('@')) return { type: 'handle', handle: parts[0].slice(1) }
    if (parts[0] === 'c' && parts[1]) return { type: 'handle', handle: parts[1] }
    return { type: 'invalid' }
  } catch {
    return { type: 'invalid' }
  }
}

export function continuationFromHtml(html: string): string | null {
  const reload = html.match(/"reloadContinuationData"\s*:\s*\{[^{}]*"continuation"\s*:\s*"([^"]+)"/)
  if (reload?.[1]) return reload[1]
  const timed = html.match(/"timedContinuationData"\s*:\s*\{[^{}]*"continuation"\s*:\s*"([^"]+)"/)
  return timed?.[1] ?? null
}

interface IrcLine {
  tags: Record<string, string>
  command: string
  text: string
}

export function parseIrc(line: string): IrcLine | null {
  let rest = line.trim()
  if (!rest || rest.startsWith('PING') || rest.startsWith('PONG')) return null
  const tags: Record<string, string> = {}
  if (rest.startsWith('@')) {
    const space = rest.indexOf(' ')
    if (space < 0) return null
    for (const part of rest.slice(1, space).split(';')) {
      const [key, ...value] = part.split('=')
      if (key) tags[key] = value.join('=').replace(/\\s/g, ' ').replace(/\\:/g, ';')
    }
    rest = rest.slice(space + 1).trim()
  }
  if (rest.startsWith(':')) {
    const space = rest.indexOf(' ')
    if (space < 0) return null
    rest = rest.slice(space + 1).trim()
  }
  const split = rest.split(' :')
  const command = split[0]?.split(' ')[0] ?? ''
  if (!command) return null
  return { tags, command, text: split.slice(1).join(' :').trim() }
}

function badgeFrom(tags: Record<string, string>): Badge {
  const badges = tags.badges ?? ''
  if (/(^|,)moderator\//.test(badges) || tags.mod === '1') return 'mod'
  if (/(^|,)vip\//.test(badges)) return 'vip'
  if (/(^|,)subscriber\//.test(badges) || tags.subscriber === '1') return 'sub'
  return null
}

function nameFrom(tags: Record<string, string>, fallback: string): string {
  const name = (tags['display-name'] || fallback || 'viewer').replace(/[^\w]/g, '').slice(0, 25)
  return name || 'viewer'
}

export function twitchItem(line: string, now: number, rng: () => number, hideBadWords: boolean): LiveItem | null {
  const parsed = parseIrc(line)
  if (!parsed) return null
  const username = nameFrom(parsed.tags, '')
  const color = colorFor(username, parsed.tags.color)
  const badge = badgeFrom(parsed.tags)
  if (parsed.command === 'PRIVMSG') {
    const bits = Number(parsed.tags.bits)
    const text = displayChatText(parsed.text, hideBadWords)
    if (!text) return null
    if (Number.isFinite(bits) && bits > 0) {
      return item(now, rng, username, badge, color, 'bits', text, `${Math.round(bits)} bits`, Math.round(bits))
    }
    return item(now, rng, username, badge, color, 'chat', text)
  }
  if (parsed.command !== 'USERNOTICE') return null
  const id = parsed.tags['msg-id'] ?? ''
  const text = displayChatText(parsed.text || noticeText(id, parsed.tags), hideBadWords)
  if (!text) return null
  if (id === 'sub' || id === 'resub') return item(now, rng, username, 'sub', color, 'sub', text)
  if (id === 'subgift' || id === 'submysterygift' || id === 'giftpaidupgrade') {
    return item(now, rng, username, 'sub', color, 'gift', text, 'gifted')
  }
  if (id === 'raid' || id === 'unraid') {
    const viewers = Number(parsed.tags['msg-param-viewerCount'] ?? parsed.tags['msg-param-viewer-count'] ?? 0)
    const raider = parsed.tags['msg-param-displayName'] || username
    return item(now, rng, nameFrom({ 'display-name': raider }, raider), null, color, 'raid', text, '', viewers)
  }
  return item(now, rng, username, badge, color, 'chat', text)
}

function noticeText(id: string, tags: Record<string, string>): string {
  if (id === 'sub' || id === 'resub') return 'subscribed'
  if (id === 'subgift' || id === 'submysterygift') return 'gifted a sub'
  if (id === 'raid') return `raiding with ${tags['msg-param-viewerCount'] ?? ''} viewers`.trim()
  return tags['system-msg']?.replace(/\\s/g, ' ') || 'hello'
}

function item(
  now: number,
  rng: () => number,
  username: string,
  badge: Badge,
  color: string,
  kind: MessageKind,
  text: string,
  amount = '',
  viewers = 0
): LiveItem {
  const message: ChatMessage = {
    id: makeId(now, rng),
    username,
    badge,
    color,
    text,
    kind,
    amount: amount || undefined,
    viewers: kind === 'raid' ? Math.max(0, Math.round(viewers)) : undefined
  }
  const alert = kind === 'donation' || kind === 'sub' || kind === 'bits' || kind === 'gift' || kind === 'raid'
  const bump = kind === 'raid' ? Math.min(500, Math.max(1, Math.round(viewers) || 1)) : alert ? 3 : 0
  return { message, alert, bump }
}

export function ytText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const record = node as Record<string, unknown>
  if (typeof record.simpleText === 'string') return record.simpleText
  if (!Array.isArray(record.runs)) return ''
  return record.runs
    .map((run) => (run && typeof run === 'object' && typeof (run as { text?: unknown }).text === 'string' ? (run as { text: string }).text : ''))
    .join('')
}

export interface ParsedLivePage {
  items: LiveItem[]
  continuation: string | null
  waitMs: number
}

export function parseInnertubeChat(payload: unknown, now: number, rng: () => number, hideBadWords: boolean): ParsedLivePage {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const contents = root.continuationContents as Record<string, unknown> | undefined
  const live = (contents?.liveChatContinuation ?? root.liveChatContinuation) as Record<string, unknown> | undefined
  const actions = Array.isArray(live?.actions) ? live.actions : []
  const items: LiveItem[] = []
  for (const action of actions) {
    const add = action && typeof action === 'object' ? (action as Record<string, unknown>).addChatItemAction : null
    const itemNode = add && typeof add === 'object' ? (add as Record<string, unknown>).item : null
    const built = itemNode && typeof itemNode === 'object' ? innertubeItem(itemNode as Record<string, unknown>, now, rng, hideBadWords) : null
    if (built) items.push(built)
  }
  const continuations = Array.isArray(live?.continuations) ? live.continuations : []
  let continuation: string | null = null
  let waitMs = 4000
  for (const entry of continuations) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const timed = (record.timedContinuationData ?? record.invalidationContinuationData ?? record.reloadContinuationData) as
      | Record<string, unknown>
      | undefined
    if (!timed || typeof timed.continuation !== 'string') continue
    continuation = timed.continuation
    if (typeof timed.timeoutMs === 'number' && Number.isFinite(timed.timeoutMs)) waitMs = timed.timeoutMs
    break
  }
  return { items, continuation, waitMs: Math.min(15_000, Math.max(1000, waitMs)) }
}

function innertubeItem(item: Record<string, unknown>, now: number, rng: () => number, hideBadWords: boolean): LiveItem | null {
  const paid = item.liveChatPaidMessageRenderer as Record<string, unknown> | undefined
  const member = item.liveChatMembershipItemRenderer as Record<string, unknown> | undefined
  const textNode = (item.liveChatTextMessageRenderer ?? paid ?? member) as Record<string, unknown> | undefined
  if (!textNode) return null
  const username = (ytText(textNode.authorName) || 'viewer').replace(/[^\w]/g, '').slice(0, 25) || 'viewer'
  const body = ytText(textNode.message) || ytText(member?.headerSubtext) || (paid ? 'super chat' : member ? 'became a member' : '')
  const text = displayChatText(body, hideBadWords)
  if (!text) return null
  if (paid) {
    const amount = ytText(paid.purchaseAmountText).slice(0, 24)
    return itemMessage(now, rng, username, null, 'donation', text, amount)
  }
  if (member) return itemMessage(now, rng, username, 'sub', 'sub', text)
  return itemMessage(now, rng, username, null, 'chat', text)
}

export function parseOfficialChat(payload: unknown, now: number, rng: () => number, hideBadWords: boolean): ParsedLivePage {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const rows = Array.isArray(root.items) ? root.items : []
  const items: LiveItem[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const snippet = (row as Record<string, unknown>).snippet as Record<string, unknown> | undefined
    const author = (row as Record<string, unknown>).authorDetails as Record<string, unknown> | undefined
    if (!snippet) continue
    const username = (typeof author?.displayName === 'string' ? author.displayName : 'viewer').replace(/[^\w]/g, '').slice(0, 25) || 'viewer'
    const type = typeof snippet.type === 'string' ? snippet.type : ''
    const display = snippet.displayMessage
    const superChat = snippet.superChatDetails as Record<string, unknown> | undefined
    const body = typeof display === 'string' ? display : type === 'superChatEvent' ? 'super chat' : type.includes('member') || type === 'newSponsorEvent' ? 'became a member' : ''
    const text = displayChatText(body, hideBadWords)
    if (!text) continue
    if (type === 'superChatEvent') {
      const amount = typeof superChat?.amountDisplayString === 'string' ? superChat.amountDisplayString.slice(0, 24) : ''
      items.push(itemMessage(now, rng, username, null, 'donation', text, amount))
    } else if (type === 'newSponsorEvent' || type.includes('member')) {
      items.push(itemMessage(now, rng, username, 'sub', 'sub', text))
    } else if (type === 'textMessageEvent' || text) {
      items.push(itemMessage(now, rng, username, null, 'chat', text))
    }
  }
  const token = typeof root.nextPageToken === 'string' ? root.nextPageToken : null
  const poll = typeof root.pollingIntervalMillis === 'number' ? root.pollingIntervalMillis : 4000
  return { items, continuation: token, waitMs: Math.min(15_000, Math.max(1000, poll)) }
}

function itemMessage(
  now: number,
  rng: () => number,
  username: string,
  badge: Badge,
  kind: MessageKind,
  text: string,
  amount = ''
): LiveItem {
  return item(now, rng, username, badge, colorFor(username), kind, text, amount)
}

export function videoIdFromUrl(url: string): string | null {
  const target = parseYoutubeTarget(url)
  return target.type === 'video' ? target.id : null
}
