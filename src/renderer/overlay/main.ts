import type { ChatMessage, OverlayState, PointerEventPayload } from '@shared/types'

interface ChatBridge {
  ready(): void
  setIgnoreMouse(ignore: boolean): void
  pointer(payload: PointerEventPayload): void
  onMessage(callback: (message: ChatMessage) => void): () => void
  onState(callback: (state: OverlayState) => void): () => void
}

declare global {
  interface Window {
    chat: ChatBridge
  }
}

const panel = document.querySelector('#panel') as HTMLElement
const log = document.querySelector('#log') as HTMLElement
const analyzing = document.querySelector('#analyzing') as HTMLElement
const paused = document.querySelector('#paused') as HTMLElement
const speed = document.querySelector('#speed') as HTMLElement
const mic = document.querySelector('#mic') as HTMLElement
const micLabel = document.querySelector('#mic-label') as HTMLElement
const hype = document.querySelector('#hype') as HTMLElement
const hypeLabel = document.querySelector('#hype-label') as HTMLElement
const hypeFill = document.querySelector('#hype-fill') as HTMLElement

let stick = true
let speedTimer = 0
let hypeTimer = 0
let lastFlash = 0
let hovering = false

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
document.documentElement.addEventListener('mouseleave', () => {
  hovering = false
  window.chat.setIgnoreMouse(true)
})

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

function badge(kind: ChatMessage['badge']): HTMLElement | null {
  if (!kind) return null
  const el = document.createElement('span')
  el.className = `badge ${kind}`
  el.textContent = kind === 'mod' ? 'MOD' : kind === 'vip' ? 'VIP' : 'SUB'
  return el
}

function safeColor(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#8eb6ff'
}

function append(message: ChatMessage): void {
  const line = document.createElement('p')
  line.className = `line ${message.kind}`
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
  if (message.kind === 'donation') {
    const amount = message.amount ? ` ${message.amount}` : ''
    return `${message.username} donated${amount} — ${message.text}`
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
  document.documentElement.style.setProperty('--font-size', `${state.fontSize}px`)
  document.documentElement.style.setProperty('--panel-opacity', String(state.opacity))
  analyzing.classList.toggle('hidden', !state.analyzing)
  paused.classList.toggle('hidden', !state.capturePaused)
  mic.classList.toggle('hidden', !state.micLive && !state.micNote)
  micLabel.textContent = state.micNote || 'Mic live'
  if (state.speedFlash !== lastFlash) {
    lastFlash = state.speedFlash
    if (state.speedFlash > 0) {
      speed.textContent = `${meter(state.speedLevel)}  ${state.speedLevel}`
      speed.classList.remove('hidden')
      window.clearTimeout(speedTimer)
      speedTimer = window.setTimeout(() => speed.classList.add('hidden'), 1100)
    }
  }
}

window.chat.onMessage(append)
window.chat.onState(applyState)
window.chat.ready()
