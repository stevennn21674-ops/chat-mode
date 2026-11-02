import type { CustomCrowd } from '@shared/custom-viewers'
import type { MicDevice, SettingsView } from '@shared/types'
import { mountCustom } from './custom'

interface SettingsBridge {
  get(): Promise<SettingsView>
  update(patch: Partial<SettingsView>): Promise<SettingsView>
  resetPosition(): Promise<SettingsView>
  listMics(): Promise<MicDevice[]>
  setKey(key: string): Promise<SettingsView>
  test(draft: { apiKey: string; model: string; baseUrl: string }): Promise<{ ok: boolean; detail: string }>
  customGet(): Promise<CustomCrowd>
  customSet(crowd: CustomCrowd): Promise<CustomCrowd>
  customExport(): Promise<boolean>
  customImport(): Promise<CustomCrowd>
  downloadBrain(): Promise<{ ok: boolean; detail: string }>
  deleteBrain(): Promise<SettingsView>
  onChange(callback: (view: SettingsView) => void): () => void
}

declare global {
  interface Window {
    settings: SettingsBridge
  }
}

const enabled = document.querySelector('#enabled') as HTMLInputElement
const screen = document.querySelector('#screen') as HTMLInputElement
const voice = document.querySelector('#voice') as HTMLInputElement
const pcAudio = document.querySelector('#pc-audio') as HTMLInputElement
const startup = document.querySelector('#startup') as HTMLInputElement
const offline = document.querySelector('#offline') as HTMLInputElement
const debugTranscript = document.querySelector('#debug-transcript') as HTMLInputElement
const gameMode = document.querySelector('#game-mode') as HTMLInputElement
const offlineNote = document.querySelector('#offline-note') as HTMLElement
const mic = document.querySelector('#mic') as HTMLSelectElement
const speed = document.querySelector('#speed') as HTMLInputElement
const opacity = document.querySelector('#opacity') as HTMLInputElement
const font = document.querySelector('#font') as HTMLInputElement
const speedOut = document.querySelector('#speed-out') as HTMLOutputElement
const opacityOut = document.querySelector('#opacity-out') as HTMLOutputElement
const fontOut = document.querySelector('#font-out') as HTMLOutputElement
const pause = document.querySelector('#pause') as HTMLButtonElement
const reset = document.querySelector('#reset') as HTMLButtonElement
const status = document.querySelector('#status') as HTMLElement
const speech = document.querySelector('#speech') as HTMLElement
const hook = document.querySelector('#hook') as HTMLElement
const ai = document.querySelector('#ai') as HTMLInputElement
const localBrain = document.querySelector('#local-brain') as HTMLInputElement
const brainSpeed = document.querySelector('#brain-speed') as HTMLSelectElement
const brainSize = document.querySelector('#brain-size') as HTMLSelectElement
const brainNote = document.querySelector('#brain-note') as HTMLElement
const brainProgress = document.querySelector('#brain-progress') as HTMLProgressElement
const brainDownload = document.querySelector('#brain-download') as HTMLButtonElement
const brainDelete = document.querySelector('#brain-delete') as HTMLButtonElement
const eco = document.querySelector('#eco') as HTMLInputElement
const cap = document.querySelector('#cap') as HTMLInputElement
const capOut = document.querySelector('#cap-out') as HTMLOutputElement
const usage = document.querySelector('#usage') as HTMLElement
const base = document.querySelector('#base') as HTMLInputElement
const modelName = document.querySelector('#model-name') as HTMLInputElement
const keyInput = document.querySelector('#key') as HTMLInputElement
const reveal = document.querySelector('#reveal') as HTMLButtonElement
const test = document.querySelector('#test') as HTMLButtonElement
const testResult = document.querySelector('#test-result') as HTMLElement
const keyHint = document.querySelector('#key-hint') as HTMLElement
const relay = document.querySelector('#relay') as HTMLElement
const proxy = document.querySelector('#proxy') as HTMLInputElement
const token = document.querySelector('#token') as HTMLInputElement

function idleValue(input: HTMLInputElement, value: string): void {
  if (document.activeElement === input) return
  input.value = value
}

function render(view: SettingsView): void {
  enabled.checked = view.enabled
  screen.checked = view.screenReaction
  voice.checked = view.voiceEnabled
  pcAudio.checked = view.hearComputerAudio
  startup.checked = view.launchAtStartup
  offline.checked = view.offlineMode
  debugTranscript.checked = view.showDebugTranscript
  gameMode.checked = view.overlayMode === 'game'
  offlineNote.textContent = view.effectivelyOffline && !view.offlineMode ? 'No internet right now, so chat is staying offline.' : ''
  idleValue(speed, String(view.speedLevel))
  idleValue(opacity, String(Math.round(view.opacity * 100)))
  idleValue(font, String(view.fontSize))
  idleValue(proxy, view.proxyUrl)
  idleValue(token, view.proxyToken)
  ai.checked = view.aiMode
  localBrain.checked = view.localBrain
  if (document.activeElement !== brainSpeed) brainSpeed.value = view.brainSpeed
  if (document.activeElement !== brainSize) brainSize.value = view.brainSize
  brainNote.textContent = view.localBrainNote
  brainDownload.textContent = view.localBrainButton
  brainDownload.disabled = view.localBrainDownloading
  brainDelete.disabled = view.localBrainDownloading || !view.localBrainDeletable
  brainProgress.hidden = view.localBrainProgress === null
  if (view.localBrainProgress !== null) brainProgress.value = Math.round(view.localBrainProgress * 100)
  eco.checked = view.ecoMode
  idleValue(cap, String(view.maxCallsPerHour))
  idleValue(base, view.baseUrl)
  idleValue(modelName, view.model)
  if (view.includeKey) idleValue(keyInput, view.apiKey)
  capOut.textContent = String(view.maxCallsPerHour)
  usage.textContent = `Calls this hour: ${view.callsThisHour} / ${view.maxCallsPerHour}.`
  speedOut.textContent = `${view.speedLevel} / 7`
  opacityOut.textContent = `${Math.round(view.opacity * 100)}%`
  fontOut.textContent = `${view.fontSize}px`
  pause.textContent = view.capturePaused ? 'Resume screen capture' : 'Pause screen capture'
  if (view.capturePaused) status.textContent = 'Screen capture is paused.'
  else if (!view.screenReaction) status.textContent = 'Screen reactions are off.'
  else if (!view.aiMode && view.localBrain && view.localBrainReady) status.textContent = 'AI mode is off. Local brain is answering on this PC. Nothing is uploaded.'
  else if (!view.aiMode) status.textContent = 'AI mode is off. Press ` for a local screen read. Nothing is uploaded.'
  else if (view.analyzing) status.textContent = 'Screen is being analyzed.'
  else if (!view.serviceReady) status.textContent = 'Press ` when a key is saved. Until then the chat stays local.'
  else status.textContent = 'Press ` to send the screen.'
  speech.textContent = view.voiceModelReady
    ? 'On-device speech model: ready.'
    : 'On-device speech model: not installed. The mic still opens, but words will not be transcribed.'
  hook.textContent = view.hookReady
    ? 'Hold V anywhere, including in another app. Ctrl, Alt, and the Windows key are ignored.'
    : 'The global talk key is unavailable in this session.'
  relay.textContent = view.relayValid
    ? 'Leave this blank to use the built-in connection. A relay sends comments through a server you control.'
    : 'That relay URL is not a valid http(s) address, so it is being ignored.'
  if (mic.value !== view.micDeviceId && document.activeElement !== mic) mic.value = view.micDeviceId
  if (!view.encryptionAvailable) {
    keyHint.textContent = 'This PC cannot encrypt a key, so a typed key will not be saved.'
  } else if (view.hasUserKey && !view.aiMode) {
    keyHint.textContent = 'The key is encrypted on this PC. AI mode is off, so chat does not call the service.'
  } else if (view.hasUserKey) {
    keyHint.textContent = 'The key is encrypted on this PC. It is not written in plain text.'
  } else if (view.hasFallbackKey && view.aiMode) {
    keyHint.textContent = 'No key entered. A built-in fallback from the app build is used until you save one.'
  } else if (view.hasFallbackKey) {
    keyHint.textContent = 'A built-in fallback key is saved in this build. Turn AI mode on to use it.'
  } else if (view.aiMode) {
    keyHint.textContent = 'Enter a key to turn on screen and voice reactions. Leave it blank to stay on local chat.'
  } else {
    keyHint.textContent = 'AI mode is off, so chat stays on this PC. Add a key and turn AI mode on to use the service.'
  }
}

async function loadMics(selected: string): Promise<void> {
  const devices = await window.settings.listMics()
  const options = [{ deviceId: '', label: 'System default' }, ...devices]
  mic.replaceChildren(
    ...options.map((device) => {
      const option = document.createElement('option')
      option.value = device.deviceId
      option.textContent = device.label
      return option
    })
  )
  mic.value = options.some((device) => device.deviceId === selected) ? selected : ''
}

enabled.addEventListener('change', () => void window.settings.update({ enabled: enabled.checked }))
screen.addEventListener('change', () => void window.settings.update({ screenReaction: screen.checked }))
voice.addEventListener('change', () => void window.settings.update({ voiceEnabled: voice.checked }))
pcAudio.addEventListener('change', () => void window.settings.update({ hearComputerAudio: pcAudio.checked }))
startup.addEventListener('change', () => void window.settings.update({ launchAtStartup: startup.checked }))
offline.addEventListener('change', () => void window.settings.update({ offlineMode: offline.checked }))
debugTranscript.addEventListener('change', () => void window.settings.update({ showDebugTranscript: debugTranscript.checked }))
gameMode.addEventListener('change', () => void window.settings.update({ overlayMode: gameMode.checked ? 'game' : 'normal' }))
mic.addEventListener('change', () => void window.settings.update({ micDeviceId: mic.value }))
speed.addEventListener('input', () => {
  speedOut.textContent = `${speed.value} / 7`
  void window.settings.update({ speedLevel: Number(speed.value) })
})
opacity.addEventListener('input', () => {
  opacityOut.textContent = `${opacity.value}%`
  void window.settings.update({ opacity: Number(opacity.value) / 100 })
})
font.addEventListener('input', () => {
  fontOut.textContent = `${font.value}px`
  void window.settings.update({ fontSize: Number(font.value) })
})
pause.addEventListener('click', () => {
  void window.settings.get().then((view) => window.settings.update({ capturePaused: !view.capturePaused }))
})
reset.addEventListener('click', () => void window.settings.resetPosition())

ai.addEventListener('change', () => void window.settings.update({ aiMode: ai.checked }))
localBrain.addEventListener('change', () => void window.settings.update({ localBrain: localBrain.checked }))
brainSpeed.addEventListener('change', () => {
  const speed = brainSpeed.value
  if (speed === 'light' || speed === 'normal' || speed === 'heavy') void window.settings.update({ brainSpeed: speed })
})
brainSize.addEventListener('change', () => {
  const size = brainSize.value
  if (size === 'small' || size === 'medium') void window.settings.update({ brainSize: size })
})
brainDownload.addEventListener('click', () => {
  brainDownload.disabled = true
  void window.settings.downloadBrain().finally(() => {
    brainDownload.disabled = brainProgress.hidden === false
  })
})
brainDelete.addEventListener('click', () => {
  brainDelete.disabled = true
  void window.settings.deleteBrain().finally(() => {
    brainDelete.disabled = false
  })
})
eco.addEventListener('change', () => void window.settings.update({ ecoMode: eco.checked }))
cap.addEventListener('input', () => {
  capOut.textContent = cap.value
  void window.settings.update({ maxCallsPerHour: Number(cap.value) })
})

let serviceTimer = 0
function saveService(): void {
  window.clearTimeout(serviceTimer)
  serviceTimer = window.setTimeout(() => {
    void window.settings.update({ model: modelName.value, baseUrl: base.value })
    void window.settings.setKey(keyInput.value).then((view) => {
      if (view.keySaved === false) testResult.textContent = 'This PC could not encrypt the key, so it was not saved.'
      render(view)
    })
  }, 300)
}
base.addEventListener('input', saveService)
modelName.addEventListener('input', saveService)
keyInput.addEventListener('input', saveService)
reveal.addEventListener('click', () => {
  const showing = keyInput.type === 'text'
  keyInput.type = showing ? 'password' : 'text'
  reveal.textContent = showing ? 'Show' : 'Hide'
})
test.addEventListener('click', () => {
  test.disabled = true
  testResult.textContent = 'Checking the connection…'
  void window.settings
    .test({ apiKey: keyInput.value, model: modelName.value, baseUrl: base.value })
    .then((result) => {
      testResult.textContent = result.detail
    })
    .finally(() => {
      test.disabled = false
    })
})

let relayTimer = 0
function saveRelay(): void {
  window.clearTimeout(relayTimer)
  relayTimer = window.setTimeout(() => {
    void window.settings.update({ proxyUrl: proxy.value, proxyToken: token.value })
  }, 250)
}
proxy.addEventListener('input', saveRelay)
token.addEventListener('input', saveRelay)

window.settings.onChange(render)
const initial = await window.settings.get()
render(initial)
await loadMics(initial.micDeviceId)
await mountCustom({
  get: () => window.settings.customGet(),
  set: (crowd) => window.settings.customSet(crowd),
  exportFile: () => window.settings.customExport(),
  importFile: () => window.settings.customImport()
})
