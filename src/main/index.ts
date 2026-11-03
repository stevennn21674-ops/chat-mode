import { app, BrowserWindow, Menu, desktopCapturer, dialog, globalShortcut, ipcMain, net, powerMonitor, session, screen, systemPreferences, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import type { Input } from 'electron'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { callsInWindow } from '../shared/budget'
import { allowLookup, fetchWikiFact } from '../shared/lookup'
import { effectivelyOffline } from '../shared/net'
import { formatBytes, modelSpec } from '../shared/brain'
import { aiModeSpecified, canReachService, defaultAiMode, usableProxyUrl } from '../shared/settings'
import { startupStateReady } from '../shared/startup'
import { readSettingsFile } from '../shared/settings-file'
import { resolveService } from '../shared/service-defaults'
import { chooseMicrophone, describeMicFailure, normalizeTalkKey } from '../shared/mic'
import { cpuAverage, effectiveMode, perfProfile, shouldThrottle } from '../shared/performance'
import { PAUSE_HOTKEY, TALK_KEY, type ChatMessage, type MicDevice, type OverlayState, type SettingsView } from '../shared/types'
import { BrainService } from './brain-service'
import { installCrashGuard, setCrashNotify } from './crash-guard'
import { directoryBytes, fileBytes } from './disk'
import { OcrService } from './ocr-service'
import { ChatController } from './chat-controller'
import { capturePrimaryJpeg, DEMO_JPEG } from './capture'
import { testService } from './connection-test'
import { CredentialStore } from './credential-store'
import { log, logVoiceDebug, setVoiceDebugFile } from './logger'
import { LoopbackController } from './loopback'
import { loadPage, OverlayController, placeOverlay, preloadPath } from './overlay'
import { defaultPlacement, initialSize } from '../shared/placement'
import { CustomStore } from './custom-store'
import { LiveChat } from './live-chat'
import { credentialsFile, customViewersFile, resourceDir, settingsFile, usageFile, voiceDebugFile, wikiCacheFile, whisperLocation, youtubeKeyFile } from './paths'
import { ScreenWatch } from './screen-watch'
import { getServiceConfig } from './service-config'
import { SettingsStore } from './store'
import { asFloat32, TalkController } from './talk'
import { createTray } from './tray'
import { UsageStore } from './usage-store'

installCrashGuard(dialog)

let lastInputAt = Date.now()
const cpuWindow: number[] = []
let overlayFps: number | null = null

function throttledNow(): boolean {
  return shouldThrottle(cpuAverage(cpuWindow), overlayFps)
}

function overlayGpuEnabled(): boolean {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf8')) as { overlayGpu?: unknown }
    return raw.overlayGpu !== false
  } catch {
    return true
  }
}

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
  if (!overlayGpuEnabled()) app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
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
  if (!startupStateReady()) {
    log('startup state was not ready')
    return
  }
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

  let controllerRef: ChatController | null = null
  setVoiceDebugFile(voiceDebugFile())
  setCrashNotify((line) => {
    logVoiceDebug(line)
    try {
      controllerRef?.setMicFault(line)
    } catch {
      // The overlay is not up yet.
    }
  })
  const settingsPath = settingsFile()
  const specifiedAiMode = aiModeSpecified(readRawSettings(settingsPath))
  const store = new SettingsStore(settingsPath, readSettingsFile(settingsPath))
  const credentials = new CredentialStore(credentialsFile())
  const youtubeKeys = new CredentialStore(youtubeKeyFile())
  let liveStatus = 'Not connected'
  let micAccess = 'unknown'
  let liveRef: LiveChat | null = null
  if (specifiedAiMode === null) {
    const hasKey = credentials.get().length > 0 || getServiceConfig().apiKey.length > 0
    store.settings.aiMode = defaultAiMode(hasKey, null)
  }
  const usage = new UsageStore(usageFile())
  const customs = new CustomStore(customViewersFile())
  const brain = new BrainService({
    userDataDir: app.getPath('userData'),
    resourceDir: resourceDir('brain'),
    log,
    getSettings: () => store.settings,
    notify: () => {
      if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('settings:changed', view(false))
    }
  })
  brain.startSampler()
  const ocr = new OcrService({
    dir: join(app.getPath('userData'), 'ocr'),
    log: logVoiceDebug,
    notify: () => {
      if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('settings:changed', view(false))
    },
    online: () => !effectivelyOffline(store.settings.offlineMode, reachable),
    enabled: () => store.settings.readScreenText
  })
  if (store.settings.readScreenText) void ocr.prepare()
  const wikiStamps: number[] = []
  const wikiCache = loadWikiCache(wikiCacheFile())
  let reachable = true
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
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  guard(voice)
  const loopback = new LoopbackController(voice, log)
  voice.webContents.on('did-finish-load', () => {
    syncRuntime()
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
    log,
    logVoice: logVoiceDebug,
    offline: () => effectivelyOffline(store.settings.offlineMode, reachable),
    customCrowd: () => customs.crowd,
    lookup: (name) => lookupName(name),
    brain: {
      ready: () => brain.ready(),
      cpu: () => brain.cpu(),
      generate: (turn) => brain.generate(turn)
    },
    sendAlert: (alert) => {
      if (!chatRef || chatRef.win.isDestroyed()) return
      chatRef.win.webContents.send('overlay:alert', alert)
    },
    liveLines: () => liveRef?.recent() ?? [],
    ocr: async (jpeg, hash) => {
      try {
        return await ocr.read(jpeg, hash)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'on-screen text failed'
        logVoiceDebug(`on-screen text failed: ${message}`)
        return ''
      }
    },
    throttled: throttledNow
  })
  controllerRef = controller

  const overlay = new OverlayController(
    placeOverlay(store.settings),
    (direction) => controller.changeSpeed(direction),
    (bounds) => {
      store.update({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
      refresh()
    }
  )
  chatRef = overlay
  overlay.setLocked(store.settings.lockPosition)
  guard(overlay.win)
  loadPage(overlay.win, 'overlay')
  const live = new LiveChat({
    getSettings: () => store.settings,
    offline: () => effectivelyOffline(store.settings.offlineMode, reachable),
    youtubeKey: () => youtubeKeys.get(),
    onItem: (item) => controller.acceptLive(item),
    onStatus: (text) => {
      if (text === liveStatus) return
      liveStatus = text
      if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('settings:changed', view(false))
    },
    onActive: (active) => controller.setLiveActive(active),
    log
  })
  liveRef = live
  const screenWatch = new ScreenWatch({
    getSettings: () => store.settings,
    power: powerState,
    onActivity: (event) => controller.noteActivity(event),
    log,
    throttled: throttledNow
  })

  const talk = new TalkController({
    voice,
    voiceEnabled: () => store.settings.voiceEnabled,
    chatEnabled: () => store.settings.enabled,
    deviceId: () => store.settings.micDeviceId,
    mode: () => store.settings.talkMode,
    onLive: (live) => controller.setMicLive(live),
    onLevel: (level) => controller.setMicLevel(level),
    onNote: (note) => controller.setMicNote(note),
    onFault: (reason) => controller.setMicFault(reason),
    onRelease: () => {
      void controller.prepareVoiceScreen()
    },
    onTranscript: (text) => {
      void controller.noteSpeech(text)
    },
    log: (message) => {
      log(message)
      logVoiceDebug(message)
    }
  })

  // The tray renders (and reads status) before createTray returns.
  let captureHintUntil = 0
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
    setAiMode: (value) => {
      store.update({ aiMode: value })
      refresh()
    },
    setOffline: (value) => {
      store.update({ offlineMode: value })
      refresh()
    },
    setOverlayMode: (mode) => {
      store.update({ overlayMode: mode })
      overlay.pin()
      refresh()
    },
    setPaused: (value) => controller.setCapturePaused(value),
    slower: () => controller.changeSpeed('slower'),
    faster: () => controller.changeSpeed('faster'),
    setLock: (value) => {
      store.update({ lockPosition: value })
      overlay.setLocked(value)
      refresh()
    },
    openSettings: () => openSettings(),
    resetPosition: () => resetPosition(),
    status: () => statusText()
  })

  function publish(state: OverlayState): void {
    if (!overlay.win.isDestroyed()) overlay.win.webContents.send('overlay:state', state)
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('settings:changed', view())
    }
    tray.tray.setToolTip(statusText())
  }

  function flashCapture(): void {
    const now = Date.now()
    if (now < captureHintUntil) return
    captureHintUntil = now + 400
    tray.flash()
  }

  function refresh(): void {
    overlay.setLocked(store.settings.lockPosition)
    tray.render()
    publish(controller.snapshot())
    applyVisibility()
    live.sync()
  }

  function view(includeKey = false): SettingsView {
    const resolved = activeConfig()
    const power = powerState()
    const relay = usableProxyUrl(store.settings.proxyUrl)
    const panel = brain.panel()
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
      idle: power.idle,
      effectivelyOffline: effectivelyOffline(store.settings.offlineMode, reachable),
      localBrainReady: panel.ready,
      localBrainDownloading: panel.downloading,
      localBrainDeletable: panel.deletable,
      localBrainProgress: panel.progress,
      localBrainNote: panel.note,
      localBrainButton: panel.button,
      diskUsed: formatBytes(directoryBytes(join(app.getPath('userData'), 'brain')) + directoryBytes(join(app.getPath('userData'), 'ocr')) + fileBytes(wikiCacheFile())),
      ocrNote: ocr.status(),
      youtubeApiKey: includeKey ? youtubeKeys.get() : '',
      hasYoutubeKey: youtubeKeys.get().length > 0,
      liveStatus,
      audioDetail: controller.audioDetail(),
      micAccess: micAccess
    }
  }

  function loopbackWanted(): boolean {
    return store.settings.hearComputerAudio && perfProfile(effectiveMode(store.settings.performanceMode, throttledNow())).loopback
  }

  function syncRuntime(): void {
    loopback.setEnabled(loopbackWanted())
    const vad = store.settings.enabled && store.settings.voiceEnabled && store.settings.talkMode === 'vad'
    const nextArm = `${vad ? 'vad' : 'off'}:${store.settings.micDeviceId}`
    if (nextArm !== armKey && !voice.isDestroyed()) {
      armKey = nextArm
      voice.webContents.send('voice:command', {
        type: 'arm',
        deviceId: store.settings.micDeviceId,
        mode: vad ? 'vad' : 'off'
      })
    }
    syncFallback()
  }

  function reconcileMic(devices: MicDevice[]): void {
    const next = chooseMicrophone(devices, store.settings.micDeviceId)
    if (next === store.settings.micDeviceId) return
    store.update({ micDeviceId: next })
    syncRuntime()
  }

  let fallbackAccel = ''
  let armKey = ''
  function syncFallback(): void {
    const accel = hookReady || !store.settings.talkFallback ? '' : `Alt+${normalizeTalkKey(store.settings.talkKey)}`
    if (accel === fallbackAccel) return
    if (fallbackAccel) globalShortcut.unregister(fallbackAccel)
    fallbackAccel = ''
    if (!accel) return
    if (globalShortcut.register(accel, () => talk.fallbackPress())) fallbackAccel = accel
    else logVoiceDebug(`fallback hotkey ${accel} did not register`)
  }

  function statusText(): string {
    const offline = effectivelyOffline(store.settings.offlineMode, reachable) ? ' — offline' : ''
    if (!store.settings.enabled) return `Chat Mode is hidden${offline}`
    if (store.settings.capturePaused) return `Chat Mode — capture paused${offline}`
    return `Chat Mode${offline}`
  }

  async function lookupName(name: string): Promise<string | null> {
    if (effectivelyOffline(store.settings.offlineMode, reachable)) return null
    const key = name.toLowerCase()
    const cached = wikiCache[key]
    if (cached) return cached
    if (!allowLookup(wikiStamps, Date.now())) return null
    const fact = await fetchWikiFact(name, fetch)
    if (!fact) return null
    wikiCache[key] = fact
    saveWikiCache(wikiCacheFile(), wikiCache)
    return fact
  }

  async function probe(): Promise<void> {
    let online = true
    try {
      online = net.isOnline()
    } catch {
      online = true
    }
    if (!online) {
      reachable = false
      tray.tray.setToolTip(statusText())
      return
    }
    if (store.settings.offlineMode) return
    try {
      const response = await fetch('https://example.com/', { method: 'GET', signal: AbortSignal.timeout(3000) })
      reachable = response.ok || response.status < 500
    } catch {
      reachable = false
    }
    tray.tray.setToolTip(statusText())
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
      height: 1040,
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
  ipcMain.on('overlay:fps', (_event, value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) overlayFps = value
  })
  ipcMain.handle('settings:get', () => view(true))
  ipcMain.handle('settings:set-key', (_event, key: unknown) => {
    if (typeof key !== 'string') return { ...view(false), keySaved: false }
    const saved = credentials.set(key)
    refresh()
    return { ...view(true), keySaved: saved }
  })
  ipcMain.handle('settings:test', async (_event, draft: unknown) => {
    if (effectivelyOffline(store.settings.offlineMode, reachable)) {
      return { ok: false, detail: 'Offline, so the connection was not tested.' }
    }
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
    const readText = store.settings.readScreenText
    if (patch && typeof patch === 'object' && typeof (patch as { capturePaused?: unknown }).capturePaused === 'boolean') {
      controller.setCapturePaused((patch as { capturePaused: boolean }).capturePaused)
    }
    if (patch && typeof patch === 'object' && typeof (patch as { youtubeApiKey?: unknown }).youtubeApiKey === 'string') {
      youtubeKeys.set((patch as { youtubeApiKey: string }).youtubeApiKey)
    }
    store.update(patch)
    brain.onSettings()
    if (store.settings.launchAtStartup !== before) applyLogin(store.settings.launchAtStartup)
    syncRuntime()
    if (store.settings.readScreenText && !readText) void ocr.prepare()
    refresh()
    return view(false)
  })
  ipcMain.handle('settings:reset', () => {
    resetPosition()
    return view()
  })
  ipcMain.handle('settings:mics', async () => {
    const devices = await listMics(voice)
    reconcileMic(devices)
    return devices
  })
  ipcMain.handle('alerts:test', () => {
    controller.testDonation()
    return true
  })
  ipcMain.handle('brain:download', async () => {
    if (effectivelyOffline(store.settings.offlineMode, reachable)) {
      return { ok: false, detail: 'Offline, so the model was not downloaded. Local brain needs the network only for that download.' }
    }
    const spec = modelSpec(store.settings.brainSize)
    const parent = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : undefined
    const again = brain.selectedOnDisk()
    const options = {
      type: 'question' as const,
      buttons: ['Download', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Download local brain',
      message: again ? `Download the ${spec.label.toLowerCase()} model again?` : `Download the ${spec.label.toLowerCase()} model?`,
      detail: `It is ${formatBytes(spec.bytes)}. After it is saved, local brain works with no network. You can delete it later to free disk.`
    }
    const confirm = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (confirm.response !== 0) return { ok: false, detail: 'Download cancelled.' }
    const result = await brain.download(store.settings.brainSize)
    refresh()
    return result
  })
  ipcMain.handle('settings:test-mic', async () => {
    const result = await talk.testMic()
    syncRuntime()
    return result
  })
  ipcMain.handle('settings:diagnose-mic', async () => {
    const devices = await listMics(voice)
    reconcileMic(devices)
    const stages = await talk.diagnose({ access: micAccess, hookReady, devices })
    syncRuntime()
    return stages
  })
  ipcMain.handle('brain:delete-all', async () => {
    const parent = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : undefined
    const options = {
      type: 'question' as const,
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Delete downloaded data',
      message: 'Delete all data Chat Mode downloaded on this PC?',
      detail: 'This removes local brain models and the on-screen text file. Settings and your API key stay. Chat keeps working with the built-in lines.'
    }
    const confirm = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (confirm.response !== 0) return view(false)
    brain.deleteModels()
    ocr.wipe()
    rmSync(wikiCacheFile(), { force: true })
    for (const key of Object.keys(wikiCache)) delete wikiCache[key]
    refresh()
    return view(false)
  })
  ipcMain.handle('brain:delete', async () => {
    const parent = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : undefined
    const options = {
      type: 'question' as const,
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Delete local brain',
      message: 'Delete the local model from this PC?',
      detail: 'This frees the space used by the downloaded models. Chat falls back to the built-in lines until you download a model again.'
    }
    const confirm = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (confirm.response !== 0) return view(false)
    brain.deleteModels()
    refresh()
    return view(false)
  })
  ipcMain.handle('custom:get', () => customs.crowd)
  ipcMain.handle('custom:set', (_event, raw: unknown) => customs.replace(raw))
  ipcMain.handle('custom:export', async () => {
    const parent = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : undefined
    const options: SaveDialogOptions = {
      defaultPath: 'chat-mode-viewers.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, customs.serialize())
    return true
  })
  ipcMain.handle('custom:import', async () => {
    const parent = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : undefined
    const options: OpenDialogOptions = {
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    const file = result.filePaths[0]
    if (result.canceled || !file) return customs.crowd
    try {
      return customs.replace(JSON.parse(readFileSync(file, 'utf8')) as unknown)
    } catch {
      return customs.crowd
    }
  })
  ipcMain.on('voice:audio', (_event, payload: unknown) => {
    const record = payload as { sampleRate?: unknown; pcm?: unknown; encoding?: unknown; purpose?: unknown }
    const encoding = record?.encoding === 'f32le' ? 'f32le' : undefined
    const pcm = asFloat32(record?.pcm, encoding)
    const sampleRate = typeof record?.sampleRate === 'number' ? record.sampleRate : 0
    const purpose = record?.purpose === 'test' ? 'test' : record?.purpose === 'diagnose' ? 'diagnose' : 'talk'
    if (!pcm || sampleRate <= 0) {
      talk.fail('recording was empty')
      return
    }
    void talk.audio(sampleRate, pcm, purpose)
  })
  ipcMain.on('voice:level', (_event, level: unknown) => {
    if (typeof level === 'number') talk.level(level)
  })
  ipcMain.on('voice:error', (_event, code: unknown) => {
    const record = code && typeof code === 'object' ? (code as { code?: unknown; detail?: unknown; quiet?: unknown }) : { code }
    const detail = typeof record.detail === 'string' ? record.detail : describeMicFailure(String(record.code ?? ''), '').detail
    if (record.quiet) {
      logVoiceDebug(detail)
      return
    }
    talk.fail(detail)
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
  bindLocalTalk(overlay.win, talk, onCaptureKey, () => store.settings.talkKey)
  bindLocalTalk(voice, talk, onCaptureKey, () => store.settings.talkKey)

  const registered = globalShortcut.register('CommandOrControl+Shift+F8', () => {
    controller.toggleCapture()
    refresh()
  })
  if (!registered) log('pause hotkey is unavailable')

  hookReady = await startHook(
    talk,
    () => store.settings.talkKey,
    () => overlay.endGesture(),
    (button) => overlay.mouseDown(button),
    onCaptureKey
  )
  syncFallback()
  void ensureMicPermission().then((status) => {
    micAccess = status
    if (status === 'denied' || status === 'restricted') {
      const failure = describeMicFailure('NotAllowedError', status)
      logVoiceDebug(failure.detail)
      controller.setMicFault(failure.detail)
    }
  })
  controller.start(publish)
  screenWatch.start()
  live.sync()
  refresh()
  if (process.env.CHATMODE_SETTINGS === '1') openSettings()
  const pin = (): void => overlay.pin()
  screen.on('display-added', pin)
  screen.on('display-removed', pin)
  screen.on('display-metrics-changed', pin)
  overlay.win.on('blur', pin)
  app.on('browser-window-focus', pin)
  let pinTick = 0
  setInterval(() => {
    pinTick += 1
    const game = store.settings.overlayMode === 'game'
    if (!overlay.win.isDestroyed() && overlay.win.isVisible() && (game || pinTick % 2 === 0)) overlay.pin()
    tray.tray.setToolTip(statusText())
  }, 1000)
  let ambientAt = 0
  let loopWas = loopbackWanted()
  setInterval(() => {
    const sample = brain.cpu()
    if (sample !== null) {
      cpuWindow.push(sample)
      if (cpuWindow.length > 5) cpuWindow.shift()
    }
    const nextLoop = loopbackWanted()
    if (nextLoop !== loopWas) {
      loopWas = nextLoop
      loopback.setEnabled(nextLoop)
    }
    const profile = perfProfile(effectiveMode(store.settings.performanceMode, throttledNow()))
    if (!profile.loopback || Date.now() - ambientAt < profile.loopbackEveryMs) return
    ambientAt = Date.now()
    void controller.listenAmbient()
  }, 5000)
  void probe()
  setInterval(() => {
    void probe()
  }, 45000)

  app.on('before-quit', () => {
    quitting = true
    loopback.setEnabled(false)
    controller.stop()
    screenWatch.stop()
    live.stop()
    brain.stop()
    brain.stopSampler()
    store.flush()
    globalShortcut.unregisterAll()
  })
  app.on('window-all-closed', () => {
    // The tray keeps the process alive.
  })
}

function loadWikiCache(file: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.length < 240) out[key.slice(0, 80).toLowerCase()] = value
    }
    return out
  } catch {
    return {}
  }
}

function saveWikiCache(file: string, cache: Record<string, string>): void {
  try {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(cache))
    renameSync(tmp, file)
  } catch {
    // Cache misses are fine.
  }
}

function readRawSettings(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch {
    return null
  }
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

function bindLocalTalk(win: BrowserWindow, talk: TalkController, onCapture: () => void, talkKey: () => string): void {
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
    if (!isPlainTalk(input, talkKey())) return
    event.preventDefault()
    if (input.type === 'keyDown' && !input.isAutoRepeat) talk.keyDown()
    if (input.type === 'keyUp') talk.keyUp()
  })
}

function isPlainTalk(input: Input, key: string): boolean {
  return input.key.toLowerCase() === normalizeTalkKey(key).toLowerCase() && !input.control && !input.alt && !input.meta
}

function isPlainGrave(input: Input): boolean {
  return input.code === 'Backquote' && !input.control && !input.alt && !input.meta && !input.shift
}

async function ensureMicPermission(): Promise<string> {
  try {
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (process.platform === 'darwin' && status !== 'granted') {
      const ok = await systemPreferences.askForMediaAccess('microphone')
      return ok ? 'granted' : 'denied'
    }
    return status
  } catch {
    return 'unknown'
  }
}

async function startHook(
  talk: TalkController,
  talkKey: () => string,
  endGesture: () => void,
  onMouseDown: (button: 'left' | 'right') => void,
  onCapture: () => void
): Promise<boolean> {
  try {
    const { uIOhook, UiohookKey } = await import('uiohook-napi')
    const codes = UiohookKey as Record<string, number>
    let graveHeld = false
    let talkHeld = false
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
      const code = codes[normalizeTalkKey(talkKey())]
      if (event.keycode !== code || event.ctrlKey || event.altKey || event.metaKey) return
      if (talkHeld) return
      talkHeld = true
      talk.keyDown()
    })
    uIOhook.on('mousemove', () => noteActivity())
    uIOhook.on('mousedown', (event) => {
      noteActivity()
      const button = event.button === 1 ? 'left' : event.button === 2 ? 'right' : null
      if (button) onMouseDown(button)
    })
    uIOhook.on('keyup', (event) => {
      if (event.keycode === UiohookKey.Backquote) graveHeld = false
      const code = codes[normalizeTalkKey(talkKey())]
      if (event.keycode === code) {
        talkHeld = false
        talk.keyUp()
      }
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
