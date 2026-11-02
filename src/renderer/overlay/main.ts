import { formatViewerCount } from '@shared/crowd'
import { synthTone } from '@shared/tones'
import type { AlertBanner, ChatMessage, OverlayState, PointerEventPayload } from '@shared/types'

interface ChatBridge {
  ready(): void
  setIgnoreMouse(ignore: boolean): void
  pointer(payload: PointerEventPayload): void
  onMessage(callback: (message: ChatMessage) => void): () => void
  onState(callback: (state: OverlayState) => void): () => void
  onAlert(callback: (alert: AlertBanner) => void): () => void
}

declare global {
  interface Window {
    chat: ChatBridge
  }
}

const panel = document.querySelector('#panel') as HTMLElement
const log = document.querySelector('#log') as HTMLElement
const viewers = document.querySelector('#viewers') as HTMLElement
const viewerCount = document.querySelector('#viewer-count') as HTMLElement
const paused = document.querySelector('#paused') as HTMLElement
const speed = document.querySelector('#speed') as HTMLElement
const mic = document.querySelector('#mic') as HTMLElement
const micLabel = document.querySelector('#mic-label') as HTMLElement
const hype = document.querySelector('#hype') as HTMLElement
const hypeLabel = document.querySelector('#hype-label') as HTMLElement
const hypeFill = document.querySelector('#hype-fill') as HTMLElement
const debug = document.querySelector('#debug') as HTMLElement
const alertBox = document.querySelector('#alert') as HTMLElement
const alertKicker = document.querySelector('#alert-kicker') as HTMLElement
const alertMain = document.querySelector('#alert-main') as HTMLElement
const alertText = document.querySelector('#alert-text') as HTMLElement

let stick = true
let hypeTimer = 0
let alertTimer = 0
let hovering = false
let audioCtx: AudioContext | null = null

log.addEventListener('scroll', () => {
  stick = log.scrollHeight - log.scrollTop - log.clientHeight < 48
})

function setHover(x: number, y: number): void {
  const el = document.elementFromPoint(x, y)
  const over = Boolean(el?.closest('#panel'))
  if (over === hovering) return
  hovering = over
  window.chat.setIgnoreMouse(!over)
}

window.addEventListener('mousemove', (event) => setHover(event.clientX, event.clientY))
panel.addEventListener('pointerdown', (event) => {
  if (event.button === 1) return
  const resize = (event.target as HTMLElement).closest('#resize')
  window.chat.pointer({
    type: 'down',
    button: event.button === 2 ? 'right' : 'left',
    mode: resize ? 'resize' : 'chat'
  })
})

window.addEventListener('pointerup', (event) => {
  if (event.button === 1) return
  window.chat.pointer({
    type: 'up',
    button: event.button === 2 ? 'right' : 'left',
    mode: 'chat'
  })
})

window.addEventListener('contextmenu', (event) => event.preventDefault())

function swordBadge(): HTMLElement {
  const el = document.createElement('span')
  el.className = 'badge mod'
  el.title = 'Moderator'
  el.setAttribute('aria-label', 'Moderator')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('fill', 'currentColor')
  path.setAttribute('d', 'M12.8 1.2 14.8 3.2 13.6 4.4 11.6 2.4 12.8 1.2zM10.9 3.1 12.9 5.1 6.2 11.8 4.2 9.8 10.9 3.1zM3.4 10.6 5.4 12.6 3.2 14.2 1.8 14.8 2.4 13.4 3.4 10.6z')
  svg.append(path)
  el.append(svg)
  return el
}

function badge(kind: ChatMessage['badge']): HTMLElement | null {
  if (!kind) return null
  if (kind === 'mod') return swordBadge()
  const el = document.createElement('span')
  el.className = `badge ${kind}`
  el.textContent = kind === 'vip' ? 'VIP' : 'SUB'
  return el
}

function purgeUser(name: string): void {
  const key = name.toLowerCase()
  for (const line of [...log.querySelectorAll<HTMLElement>('.line')]) {
    if ((line.dataset.user ?? '').toLowerCase() === key) line.remove()
  }
}

function safeColor(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#8eb6ff'
}

function append(message: ChatMessage): void {
  if (message.purgeUser) purgeUser(message.purgeUser)
  const line = document.createElement('p')
  line.className = `line ${message.kind}`
  if (message.kind !== 'system') line.dataset.user = message.username
  if (message.kind === 'chat') {
    const mark = badge(message.badge)
    if (mark) line.append(mark)
    const name = document.createElement('span')
    name.className = 'name'
    name.style.color = safeColor(message.color)
    name.textContent = message.username
    const colon = document.createElement('span')
    colon.className = 'name'
    colon.style.color = safeColor(message.color)
    colon.textContent = ':'
    const text = document.createElement('span')
    text.className = 'text'
    text.textContent = ` ${message.text}`
    line.append(name, colon, text)
  } else {
    const text = document.createElement('span')
    text.className = 'text'
    text.textContent = eventText(message)
    line.append(text)
  }
  log.append(line)
  while (log.querySelectorAll('.line').length > 80) log.querySelector('.line')?.remove()
  if (stick) log.scrollTop = log.scrollHeight
  if (message.kind === 'hype') showHype(message)
}

function eventText(message: ChatMessage): string {
  if (message.kind === 'donation' || message.kind === 'bits' || message.kind === 'gift') {
    const amount = message.amount ? ` ${message.amount}` : ''
    return `${message.username} ${message.kind === 'donation' ? 'donated' : message.kind === 'bits' ? 'cheered' : 'gifted'}${amount} — ${message.text}`
  }
  if (message.kind === 'sub') return `${message.username} ${message.text}`
  if (message.kind === 'raid') {
    const viewers = message.viewers ? ` with ${message.viewers} viewers` : ''
    return `${message.username} is raiding${viewers}`
  }
  return message.text
}

function showHype(message: ChatMessage): void {
  const level = message.hypeLevel ?? 1
  const progress = message.hypeProgress ?? 40
  hypeLabel.textContent = `Hype train level ${level}`
  hypeFill.style.width = `${Math.max(8, Math.min(100, progress))}%`
  hype.classList.remove('hidden')
  hype.setAttribute('aria-hidden', 'false')
  window.clearTimeout(hypeTimer)
  hypeTimer = window.setTimeout(() => {
    hype.classList.add('hidden')
    hype.setAttribute('aria-hidden', 'true')
  }, 18000)
}

function meter(level: number): string {
  return Array.from({ length: 7 }, (_unused, index) => (index < level ? '●' : '○')).join('')
}

function applyState(state: OverlayState): void {
  if (typeof state.viewerCount === 'number') {
    const label = formatViewerCount(state.viewerCount)
    viewerCount.textContent = label
    viewers.setAttribute('aria-label', `${label} viewers`)
  }
  document.documentElement.style.setProperty('--font-size', `${state.fontSize}px`)
  document.documentElement.style.setProperty('--panel-opacity', String(state.opacity))
  speed.textContent = `${meter(state.speedLevel)}  ${state.speedLevel}`
  paused.classList.toggle('hidden', !state.capturePaused)
  mic.classList.toggle('hidden', !state.micLive && !state.micNote)
  micLabel.textContent = state.micNote || 'Mic live'
  if (state.debugText) {
    debug.textContent = state.debugText
    debug.classList.remove('hidden')
  } else {
    debug.textContent = ''
    debug.classList.add('hidden')
  }
}

function showAlert(alert: AlertBanner): void {
  const label = alert.kind === 'donation' ? 'Donation' : alert.kind === 'bits' ? 'Bits' : alert.kind === 'gift' ? 'Gift' : alert.kind === 'sub' ? 'Sub' : alert.kind === 'raid' ? 'Raid' : 'Alert'
  alertKicker.textContent = label
  alertMain.textContent = `${alert.username}${alert.amount ? ` ${alert.amount}` : ''}`
  alertText.textContent = alert.text
  alertBox.classList.remove('hidden')
  window.clearTimeout(alertTimer)
  alertTimer = window.setTimeout(() => alertBox.classList.add('hidden'), 5000)
  if (alert.volume > 0 && (alert.sound === 'coin' || alert.sound === 'chime' || alert.sound === 'arcade' || alert.sound === 'horn')) {
    playTone(alert.sound, alert.kind, alert.volume)
  }
  if (alert.speak && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(alert.speak)
    utter.volume = Math.max(0, Math.min(1, alert.volume))
    window.speechSynthesis.speak(utter)
  }
}

function playTone(pack: AlertBanner['sound'], kind: AlertBanner['kind'], volume: number): void {
  const bytes = synthTone(pack, kind)
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  const ctx = audioCtx ?? new AudioContext()
  audioCtx = ctx
  void ctx.decodeAudioData(copy).then((buffer) => {
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    gain.gain.value = Math.max(0, Math.min(1, volume))
    source.buffer = buffer
    source.connect(gain)
    gain.connect(ctx.destination)
    source.start()
  }).catch(() => undefined)
}

window.chat.onMessage(append)
window.chat.onState(applyState)
window.chat.onAlert(showAlert)
window.chat.ready()
