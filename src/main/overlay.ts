import { BrowserWindow, screen, type Rectangle } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clampPlacement, defaultPlacement, initialSize, type Rect } from '../shared/placement'
import { LIMITS, type PointerEventPayload } from '../shared/types'

const here = fileURLToPath(new URL('.', import.meta.url))

export function preloadPath(name: string): string {
  for (const ext of ['.cjs', '.js', '.mjs']) {
    const candidate = join(here, '../preload', `${name}${ext}`)
    if (existsSync(candidate)) return candidate
  }
  return join(here, '../preload', `${name}.cjs`)
}

export function loadPage(win: BrowserWindow, page: string): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void win.loadURL(`${devUrl}/${page}/index.html`)
    return
  }
  void win.loadFile(join(here, '../renderer', page, 'index.html'))
}

export function placeOverlay(settings: { x: number | null; y: number | null; width: number; height: number }): Rectangle {
  const primary = screen.getPrimaryDisplay()
  const fallback = initialSize(primary.workArea.height)
  const size = {
    width: settings.width || fallback.width,
    height: settings.height || fallback.height
  }
  const displays = displayRects()
  const pos =
    settings.x === null || settings.y === null
      ? defaultPlacement(primary.workArea, size)
      : clampPlacement({ x: settings.x, y: settings.y }, size, displays)
  return { ...pos, ...size }
}

export function displayRects(): Rect[] {
  const primary = screen.getPrimaryDisplay()
  const others = screen.getAllDisplays().filter((display) => display.id !== primary.id)
  return [primary.workArea, ...others.map((display) => display.workArea)]
}

interface Gesture {
  kind: 'left' | 'right' | 'resize'
  sx: number
  sy: number
  bounds: Rectangle
  moved: boolean
}

export class OverlayController {
  readonly win: BrowserWindow
  private ignoring = true
  private gesture: Gesture | null = null
  private poll: NodeJS.Timeout

  constructor(
    bounds: Rectangle,
    private onSpeed: (direction: 'slower' | 'faster') => void,
    private onBounds: (bounds: Rectangle) => void
  ) {
    this.win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      thickFrame: false,
      webPreferences: {
        preload: preloadPath('overlay'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    this.pin()
    this.win.setContentProtection(true)
    this.win.setIgnoreMouseEvents(true, { forward: true })
    this.poll = setInterval(() => this.tickPointer(), 16)
    this.win.on('closed', () => clearInterval(this.poll))
  }

  pointer(payload: PointerEventPayload): void {
    if (payload.type === 'down') {
      const cursor = screen.getCursorScreenPoint()
      this.gesture = {
        kind: payload.mode === 'resize' ? 'resize' : payload.button,
        sx: cursor.x,
        sy: cursor.y,
        bounds: this.win.getBounds(),
        moved: false
      }
      return
    }
    this.endGesture()
  }

  endGesture(): void {
    const gesture = this.gesture
    if (!gesture) return
    this.gesture = null
    if (!gesture.moved && gesture.kind === 'left') this.onSpeed('slower')
    if (!gesture.moved && gesture.kind === 'right') this.onSpeed('faster')
    if (gesture.moved && (gesture.kind === 'right' || gesture.kind === 'resize')) {
      this.onBounds(this.win.getBounds())
    }
  }

  pin(): void {
    if (this.win.isDestroyed()) return
    this.win.setAlwaysOnTop(true, 'screen-saver')
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    this.win.moveTop()
  }

  setIgnore(ignore: boolean): void {
    if (this.gesture) return
    if (ignore === this.ignoring) return
    this.ignoring = ignore
    this.win.setIgnoreMouseEvents(ignore, { forward: true })
  }

  private tickPointer(): void {
    if (this.win.isDestroyed()) return
    if (this.gesture) {
      this.drag()
      return
    }
    if (!this.win.isVisible()) return
    const cursor = screen.getCursorScreenPoint()
    const bounds = this.win.getBounds()
    const inset = 12
    const over =
      cursor.x >= bounds.x + inset &&
      cursor.y >= bounds.y + inset &&
      cursor.x <= bounds.x + bounds.width - inset &&
      cursor.y <= bounds.y + bounds.height - inset
    this.setIgnore(!over)
  }

  private drag(): void {
    const gesture = this.gesture
    if (!gesture) return
    const cursor = screen.getCursorScreenPoint()
    const dx = cursor.x - gesture.sx
    const dy = cursor.y - gesture.sy
    if (Math.abs(dx) + Math.abs(dy) > 5) gesture.moved = true
    if (!gesture.moved) return
    if (gesture.kind === 'right') {
      this.win.setPosition(gesture.bounds.x + dx, gesture.bounds.y + dy)
      return
    }
    if (gesture.kind === 'resize') {
      this.win.setSize(
        clamp(gesture.bounds.width + dx, LIMITS.widthMin, LIMITS.widthMax),
        clamp(gesture.bounds.height + dy, LIMITS.heightMin, LIMITS.heightMax)
      )
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
