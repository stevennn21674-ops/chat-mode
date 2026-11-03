import { BrowserWindow, screen, type Rectangle } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clampPlacement, defaultPlacement, initialSize, type Rect } from '../shared/placement'
import {
  finishGesture,
  hitZone,
  ignoreNeedsApply,
  moveGesture,
  startGesture,
  wantsIgnore,
  type ClickButton,
  type Gesture
} from '../shared/pointer'
import type { PointerEventPayload } from '../shared/types'

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

export class OverlayController {
  readonly win: BrowserWindow
  private ignoring = true
  private gesture: Gesture | null = null
  private poll: NodeJS.Timeout
  private mouseResetTicks = 0
  private locked = false

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
        backgroundThrottling: true
      }
    })
    this.win.webContents.setFrameRate(30)
    this.pin()
    this.win.setContentProtection(true)
    this.poll = setInterval(() => this.tickPointer(), 33)
    this.win.on('closed', () => clearInterval(this.poll))
  }

  setLocked(locked: boolean): void {
    this.locked = locked
  }

  pointer(payload: PointerEventPayload): void {
    if (payload.type === 'down') {
      if (this.gesture) return
      const cursor = screen.getCursorScreenPoint()
      const bounds = this.win.getBounds()
      const zone = payload.mode === 'resize' ? 'resize' : hitZone(cursor, bounds)
      const gesture = startGesture(zone === 'outside' ? 'chat' : zone, payload.button, cursor, bounds)
      if (!gesture) return
      this.gesture = gesture
      this.mouseResetTicks = 4
      this.syncIgnore()
      return
    }
    this.endGesture()
  }

  mouseDown(button: ClickButton): void {
    if (this.gesture || this.win.isDestroyed() || !this.win.isVisible()) return
    const cursor = screen.getCursorScreenPoint()
    const bounds = this.win.getBounds()
    const gesture = startGesture(hitZone(cursor, bounds), button, cursor, bounds)
    if (!gesture) return
    this.gesture = gesture
    this.mouseResetTicks = 4
    this.syncIgnore()
  }

  endGesture(): void {
    const gesture = this.gesture
    if (!gesture) return
    this.gesture = null
    const result = finishGesture(gesture, this.locked)
    if (result.speed) this.onSpeed(result.speed)
    if (result.save) this.onBounds(this.win.getBounds())
    this.syncIgnore()
  }

  pin(): void {
    if (this.win.isDestroyed()) return
    const bounds = this.win.getBounds()
    this.win.setAlwaysOnTop(true, 'screen-saver')
    if (!this.gesture) {
      this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      this.win.moveTop()
    } else {
      this.win.setBounds(bounds)
    }
    // Re-asserting topmost clears WS_EX_TRANSPARENT on Windows. Write the
    // click-through flag again or the chat stops receiving clicks.
    this.mouseResetTicks = 8
    this.syncIgnore()
  }

  setIgnore(ignore: boolean): void {
    if (this.gesture) return
    const want = wantsIgnore(this.zone(), false)
    if (ignore !== want) return
    this.syncIgnore()
  }

  private zone() {
    if (this.win.isDestroyed() || !this.win.isVisible()) return 'outside' as const
    return hitZone(screen.getCursorScreenPoint(), this.win.getBounds())
  }

  private syncIgnore(): void {
    if (this.win.isDestroyed()) return
    const ignore = wantsIgnore(this.zone(), Boolean(this.gesture))
    const force = this.mouseResetTicks > 0
    if (this.mouseResetTicks > 0) this.mouseResetTicks -= 1
    if (!ignoreNeedsApply(this.ignoring, ignore, force)) return
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
    this.syncIgnore()
  }

  private drag(): void {
    const gesture = this.gesture
    if (!gesture) return
    const stepped = moveGesture(gesture, screen.getCursorScreenPoint(), this.locked)
    this.gesture = stepped.gesture
    if (!stepped.bounds) return
    if (gesture.kind === 'right') this.win.setPosition(stepped.bounds.x, stepped.bounds.y)
    else if (gesture.kind === 'resize') this.win.setSize(stepped.bounds.width, stepped.bounds.height)
  }
}
