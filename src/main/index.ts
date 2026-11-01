import { app, BrowserWindow, Menu, desktopCapturer, globalShortcut, ipcMain, powerMonitor, session, screen } from 'electron'
import type { Input } from 'electron'
import { existsSync } from 'node:fs'
import { callsInWindow } from '../shared/budget'
import { canReachService, usableProxyUrl } from '../shared/settings'
import { readSettingsFile } from '../shared/settings-file'
import { resolveService } from '../shared/service-defaults'
import { PAUSE_HOTKEY, TALK_KEY, type ChatMessage, type MicDevice, type OverlayState, type SettingsView } from '../shared/types'
import { ChatController } from './chat-controller'
import { capturePrimaryJpeg, DEMO_JPEG } from './capture'
import { testService } from './connection-test'
import { CredentialStore } from './credential-store'
import { log } from './logger'
import { LoopbackController } from './loopback'
import { loadPage, OverlayController, placeOverlay, preloadPath } from './overlay'
import { defaultPlacement, initialSize } from '../shared/placement'
import { credentialsFile, resourceDir, settingsFile, usageFile, whisperLocation } from './paths'
import { getServiceConfig } from './service-config'
import { SettingsStore } from './store'
import { asFloat32, TalkController } from './talk'
import { createTray } from './tray'
import { UsageStore } from './usage-store'

let lastInputAt = Date.now()

function noteActivity(): void {
  lastInputAt = Date.now()
}

function powerState(): { idle: boolean; onBattery: boolean } {
  let idleSeconds = (Date.now() - lastInputAt) / 1000
  try {
    idleSeconds = Math.max(idleSeconds, powerMonitor.getSystemIdleTime())
  } catch {
    // Idle time is unavailable in this session.
  }
  let onBattery = false
  try {
    onBattery = powerMonitor.isOnBatteryPower()
  } catch {
    onBattery = false
  }
  return { idle: idleSeconds >= 90, onBattery }
}

let quitting = false
let hookReady = false
const messageBuffer: ChatMessage[] = []
let overlayReady = false

function allowNavigation(url: string): boolean {
  if (url.startsWith('file://')) return true
  const devUrl = process.env.ELECTRON_RENDERER_URL
  return Boolean(devUrl && url.startsWith(devUrl))
}

function guard(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!allowNavigation(url)) event.preventDefault()
  })
  if (process.env.CHATMODE_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
}

function iconPath(): string | undefined {
  const path = resourceDir('icons', 'icon.png')
  return existsSync(path) ? path : undefined
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.setName('Chat Mode')
  app.on('second-instance', () => {
    settingsWindow?.show()
  })

  app.whenReady().then(() => {
    void bootstrap().catch(() => {
      log('startup failed')
    })
  })
}

let settingsWindow: BrowserWindow | null = null

async function bootstrap(): Promise<void> {
  app.setAppUserModelId('com.chatmode.desktop')
  Menu.setApplicationMenu(null)
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture')
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => {
    return permission === 'media' || permission === 'display-capture'
  })
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 }, fetchWindowIcons: false })
      .then((sources) => {
        const source = sources[0]
        if (!source) {
          callback(null)
          return
        }
        callback({ video: { id: source.id, name: source.name }, audio: 'loopback' })
      })
      .catch(() => callback(null))
  }, { useSystemPicker: false })

  const store = new SettingsStore(settingsFile(), readSettingsFile(settingsFile()))
  const credentials = new CredentialStore(credentialsFile())
  const usage = new UsageStore(usageFile())
  applyLogin(store.settings.launchAtStartup)

  const activeConfig = (): ReturnType<typeof resolveService> => {
    const baked = getServiceConfig()
    return resolveService({
      userKey: credentials.get(),
      model: store.settings.model,
      baseUrl: store.settings.baseUrl,
      fallbackKey: baked.apiKey
    })
  }

  const voice = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: preloadPath('voice'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  guard(voice)
  const loopback = new LoopbackController(voice, log)
  voice.webContents.on('did-finish-load', () => {
    loopback.setEnabled(store.settings.hearComputerAudio)
  })
  loadPage(voice, 'voice')

  let chatRef: OverlayController | null = null
  const controller = new ChatController({
    getSettings: () => store.settings,
    updateSettings: (patch) => {
      store.update(patch)
      refresh()
    },
    sendMessage: (message) => {
      if (!chatRef || !overlayReady || chatRef.win.isDestroyed()) {
        messageBuffer.push(message)
        if (messageBuffer.length > 30) messageBuffer.shift()
        return
      }
      chatRef.win.webContents.send('overlay:message', message)
    },
    config: () => {
      const resolved = activeConfig()
      return { apiKey: resolved.apiKey, model: resolved.model, endpoint: resolved.endpoint }
    },
    capture: async () => {
      if (process.env.CHATMODE_DEMO === '1') return { jpegBase64: DEMO_JPEG, hash: `demo-${Date.now()}` }
      try {
        return await capturePrimaryJpeg()
      } catch {
        log('screen capture failed')
        return null
      }
    },
    pcAudio: () => loopback.transcript(),
    usage: () => usage.usage,
    setUsage: (next) => usage.replace(next),
    power: powerState,
    log
  })

  const overlay = new OverlayController(
    placeOverlay(store.settings),
    (direction) => controller.changeSpeed(direction),
    (bounds) => {
      store.update({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
      refresh()
    }
  )
  chatRef = overlay
  guard(overlay.win)
  loadPage(overlay.win, 'overlay')

  const talk = new TalkController({
    voice,
    voiceEnabled: () => store.settings.voiceEnabled,
    chatEnabled: () => store.settings.enabled,
    deviceId: () => store.settings.micDeviceId,
    onLive: (live) => controller.setMicLive(live),
    onNote: (note) => controller.setMicNote(note),
    onTranscript: (text) => controller.noteSpeech(text),
    log
  })

  const tray = createTray({
    getSettings: () => store.settings,
    setEnabled: (value) => applyEnabled(value),
    setScreen: (value) => {
      store.update({ screenReaction: value })
      refresh()
    },
    setVoice: (value) => {
      store.update({ voiceEnabled: value })
      refresh()
    },
    setPaused: (value) => controller.setCapturePaused(value),
    openSettings: () => openSettings(),
    resetPosition: () => resetPosition(),
    status: () => statusText()
  })

  let captureHintUntil = 0

  function publish(state: OverlayState): void {
    if (!overlay.win.isDestroyed()) overlay.win.webContents.send('overlay:state', state)
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('settings:changed', view())
    }
    tray.tray.setToolTip(statusText())
  }

  function flashCapture(): void {
    captureHintUntil = Date.now() + 1400
    tray.tray.setToolTip(statusText())
    tray.flash()
  }

  function refresh(): void {
    tray.render()
    publish(controller.snapshot())
    applyVisibility()
  }

  function view(includeKey = false): SettingsView {
    const resolved = activeConfig()
    const power = powerState()
    const relay = usableProxyUrl(store.settings.proxyUrl)
    return {
      ...store.settings,
      serviceReady: process.env.CHATMODE_DEMO === '1' || canReachService(store.settings, resolved),
      voiceModelReady: whisperLocation() !== null,
      hookReady,
      analyzing: controller.snapshot().analyzing,
      micLive: controller.snapshot().micLive,
      relayValid: store.settings.proxyUrl.trim() === '' || relay !== '',
      pauseHotkey: PAUSE_HOTKEY,
      talkKey: TALK_KEY,
      apiKey: includeKey ? credentials.get() : '',
      includeKey,
      hasUserKey: credentials.get().length > 0,
      hasFallbackKey: getServiceConfig().apiKey.length > 0,
      keySource: resolved.source,
      encryptionAvailable: credentials.encryptionAvailable(),
      callsThisHour: callsInWindow(usage.usage, Date.now()),
      onBattery: power.onBattery,
      idle: power.idle
    }
  }

  function statusText(): string {
    if (!store.settings.enabled) return 'Chat Mode is hidden'
    if (store.settings.capturePaused) return 'Chat Mode — capture paused'
    if (Date.now() < captureHintUntil) return 'Chat Mode — reading the screen'
    if (controller.snapshot().analyzing) return 'Chat Mode — screen is being analyzed'
    return 'Chat Mode'
  }

  function applyVisibility(): void {
    if (overlay.win.isDestroyed()) return
    if (store.settings.enabled && !overlay.win.isVisible()) overlay.win.showInactive()
    if (!store.settings.enabled && overlay.win.isVisible()) overlay.win.hide()
  }

  function applyEnabled(value: boolean): void {
    store.update({ enabled: value })
    refresh()
  }

  function resetPosition(): void {
    const work = screen.getPrimaryDisplay().workArea
    const size = initialSize(work.height)
    const pos = defaultPlacement(work, size)
    store.update({ x: pos.x, y: pos.y, width: size.width, height: size.height })
    if (!overlay.win.isDestroyed()) overlay.win.setBounds({ ...pos, width: size.width, height: size.height })
    refresh()
  }

  function openSettings(): void {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.show()
      settingsWindow.focus()
      return
    }
    settingsWindow = new BrowserWindow({
      width: 480,
      height: 860,
      minWidth: 400,
      minHeight: 560,
      show: false,
      autoHideMenuBar: true,
      title: 'Chat Mode',
      backgroundColor: '#101218',
      icon: iconPath(),
      webPreferences: {
        preload: preloadPath('settings'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    guard(settingsWindow)
    settingsWindow.on('close', (event) => {
      if (!quitting) {
        event.preventDefault()
        settingsWindow?.hide()
      }
    })
    settingsWindow.once('ready-to-show', () => settingsWindow?.show())
    loadPage(settingsWindow, 'settings')
  }

  ipcMain.on('overlay:ready', () => {
    overlayReady = true
    publish(controller.snapshot())
    for (const message of messageBuffer) overlay.win.webContents.send('overlay:message', message)
    messageBuffer.length = 0
  })
  ipcMain.on('overlay:ignore', (_event, ignore: unknown) => {
    if (typeof ignore === 'boolean') overlay.setIgnore(ignore)
  })
  ipcMain.on('overlay:pointer', (_event, payload: unknown) => {
    if (isPointer(payload)) overlay.pointer(payload)
  })
  ipcMain.handle('settings:get', () => view(true))
  ipcMain.handle('settings:set-key', (_event, key: unknown) => {
    if (typeof key !== 'string') return { ...view(false), keySaved: false }
    const saved = credentials.set(key)
    refresh()
    return { ...view(true), keySaved: saved }
  })
  ipcMain.handle('settings:test', async (_event, draft: unknown) => {
    const record = draft && typeof draft === 'object' ? (draft as Record<string, unknown>) : {}
    const typedKey = typeof record.apiKey === 'string' ? record.apiKey : ''
    const resolved = activeConfig()
    return testService({
      apiKey: typedKey.trim() || resolved.apiKey,
      model: typeof record.model === 'string' && record.model.trim() ? record.model : resolved.model,
      baseUrl: typeof record.baseUrl === 'string' && record.baseUrl.trim() ? record.baseUrl : store.settings.baseUrl
    })
  })
  ipcMain.handle('settings:update', (_event, patch: unknown) => {
    const before = store.settings.launchAtStartup
    const heard = store.settings.hearComputerAudio
    if (patch && typeof patch === 'object' && typeof (patch as { capturePaused?: unknown }).capturePaused === 'boolean') {
      controller.setCapturePaused((patch as { capturePaused: boolean }).capturePaused)
    }
    store.update(patch)
    if (store.settings.launchAtStartup !== before) applyLogin(store.settings.launchAtStartup)
    if (store.settings.hearComputerAudio !== heard) loopback.setEnabled(store.settings.hearComputerAudio)
    refresh()
    return view(false)
  })
  ipcMain.handle('settings:reset', () => {
    resetPosition()
    return view()
  })
  ipcMain.handle('settings:mics', () => listMics(voice))
  ipcMain.on('voice:audio', (_event, payload: unknown) => {
    const record = payload as { sampleRate?: unknown; pcm?: unknown }
    const pcm = asFloat32(record?.pcm)
    const sampleRate = typeof record?.sampleRate === 'number' ? record.sampleRate : 0
    if (!pcm || sampleRate <= 0) return
    void talk.audio(sampleRate, pcm)
  })
  ipcMain.on('voice:error', (_event, code: unknown) => {
    controller.setMicNote(code === 'denied' ? 'Microphone is blocked' : 'Microphone failed')
  })
  let pcAudioNoted = false
  ipcMain.on('voice:pc-audio', () => {
    if (pcAudioNoted) return
    pcAudioNoted = true
    log('computer audio is unavailable')
  })

  overlay.win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      applyEnabled(false)
    }
  })

  const onCaptureKey = (): void => {
    if (!controller.requestScreen()) return
    flashCapture()
  }
  bindLocalTalk(overlay.win, talk, onCaptureKey)
  bindLocalTalk(voice, talk, onCaptureKey)

  const registered = globalShortcut.register('CommandOrControl+Shift+F8', () => {
    controller.toggleCapture()
    refresh()
  })
  if (!registered) log('pause hotkey is unavailable')

  hookReady = await startHook(talk, () => overlay.endGesture(), onCaptureKey)
  controller.start(publish)
  refresh()
  if (process.env.CHATMODE_SETTINGS === '1') openSettings()
  setInterval(() => {
    if (!overlay.win.isDestroyed() && overlay.win.isVisible() && !overlay.win.isAlwaysOnTop()) {
      overlay.win.setAlwaysOnTop(true, 'screen-saver')
    }
    tray.tray.setToolTip(statusText())
  }, 2000)

  app.on('before-quit', () => {
    quitting = true
    loopback.setEnabled(false)
    controller.stop()
    store.flush()
    globalShortcut.unregisterAll()
  })
  app.on('window-all-closed', () => {
    // The tray keeps the process alive.
  })
}

function applyLogin(openAtLogin: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin })
}

function isPointer(value: unknown): value is { type: 'down' | 'up'; button: 'left' | 'right'; mode: 'chat' | 'resize' } {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    (record.type === 'down' || record.type === 'up') &&
    (record.button === 'left' || record.button === 'right') &&
    (record.mode === 'chat' || record.mode === 'resize')
  )
}

function listMics(voice: BrowserWindow): Promise<MicDevice[]> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ipcMain.removeListener('voice:devices', onDevices)
      resolve([])
    }, 3000)
    const onDevices = (_event: unknown, devices: unknown): void => {
      clearTimeout(timer)
      if (!Array.isArray(devices)) {
        resolve([])
        return
      }
      resolve(
        devices
          .filter((device): device is MicDevice => {
            if (!device || typeof device !== 'object') return false
            const record = device as Record<string, unknown>
            return typeof record.deviceId === 'string' && typeof record.label === 'string'
          })
          .map((device) => ({ deviceId: device.deviceId.slice(0, 200), label: device.label.slice(0, 120) }))
      )
    }
    ipcMain.once('voice:devices', onDevices)
    if (!voice.isDestroyed()) voice.webContents.send('voice:command', { type: 'list' })
  })
}

function bindLocalTalk(win: BrowserWindow, talk: TalkController, onCapture: () => void): void {
  let graveHeld = false
  win.webContents.on('before-input-event', (event, input) => {
    if (hookReady) return
    if (isPlainGrave(input)) {
      event.preventDefault()
      if (input.type === 'keyDown' && !input.isAutoRepeat && !graveHeld) {
        graveHeld = true
        onCapture()
      }
      if (input.type === 'keyUp') graveHeld = false
      return
    }
    if (!isPlainV(input)) return
    event.preventDefault()
    if (input.type === 'keyDown' && !input.isAutoRepeat) talk.keyDown()
    if (input.type === 'keyUp') talk.keyUp()
  })
}

function isPlainV(input: Input): boolean {
  return input.key.toLowerCase() === 'v' && !input.control && !input.alt && !input.meta
}

function isPlainGrave(input: Input): boolean {
  return input.code === 'Backquote' && !input.control && !input.alt && !input.meta && !input.shift
}

async function startHook(talk: TalkController, endGesture: () => void, onCapture: () => void): Promise<boolean> {
  try {
    const { uIOhook, UiohookKey } = await import('uiohook-napi')
    let graveHeld = false
    uIOhook.on('keydown', (event) => {
      noteActivity()
      const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
      if (event.keycode === UiohookKey.Backquote && plain) {
        if (!graveHeld) {
          graveHeld = true
          onCapture()
        }
        return
      }
      if (event.keycode !== UiohookKey.V || event.ctrlKey || event.altKey || event.metaKey) return
      talk.keyDown()
    })
    uIOhook.on('mousemove', () => noteActivity())
    uIOhook.on('keyup', (event) => {
      if (event.keycode === UiohookKey.Backquote) graveHeld = false
      if (event.keycode === UiohookKey.V) talk.keyUp()
    })
    uIOhook.on('mouseup', () => endGesture())
    uIOhook.start()
    return true
  } catch {
    log('global input hook is unavailable')
    return false
  }
}

app.on('will-quit', () => {
  void import('uiohook-napi')
    .then(({ uIOhook }) => uIOhook.stop())
    .catch(() => undefined)
})
