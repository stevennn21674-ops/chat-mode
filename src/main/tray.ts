import { Menu, Tray, app, nativeImage } from 'electron'
import type { AppSettings } from '../shared/types'
import { CAPTURE_KEY, PAUSE_HOTKEY } from '../shared/types'
import { resourceDir } from './paths'

interface TrayHandlers {
  getSettings: () => AppSettings
  setEnabled: (value: boolean) => void
  setScreen: (value: boolean) => void
  setVoice: (value: boolean) => void
  setAiMode: (value: boolean) => void
  setPaused: (value: boolean) => void
  openSettings: () => void
  resetPosition: () => void
  status: () => string
}

export function createTray(handlers: TrayHandlers): { tray: Tray; render: () => void; flash: () => void } {
  const image = nativeImage.createFromPath(resourceDir('icons', 'tray.png'))
  const tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  const render = (): void => {
    const settings = handlers.getSettings()
    tray.setToolTip(handlers.status())
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Show chat',
          type: 'checkbox',
          checked: settings.enabled,
          click: (item) => handlers.setEnabled(item.checked)
        },
        {
          label: 'React to the screen',
          type: 'checkbox',
          checked: settings.screenReaction,
          click: (item) => handlers.setScreen(item.checked)
        },
        {
          label: 'Voice reactions',
          type: 'checkbox',
          checked: settings.voiceEnabled,
          click: (item) => handlers.setVoice(item.checked)
        },
        {
          label: 'AI mode',
          type: 'checkbox',
          checked: settings.aiMode,
          click: (item) => handlers.setAiMode(item.checked)
        },
        {
          label: 'Pause screen capture',
          type: 'checkbox',
          checked: settings.capturePaused,
          click: (item) => handlers.setPaused(item.checked)
        },
        { type: 'separator' },
        { label: 'Settings…', click: () => handlers.openSettings() },
        { label: 'Reset position', click: () => handlers.resetPosition() },
        { type: 'separator' },
        { label: `Capture screen: ${CAPTURE_KEY}`, enabled: false },
        { label: `Pause hotkey: ${PAUSE_HOTKEY}`, enabled: false },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
      ])
    )
  }
  const icon = image.isEmpty() ? nativeImage.createEmpty() : image
  const flash = (): void => {
    tray.setImage(nativeImage.createEmpty())
    setTimeout(() => {
      tray.setImage(icon)
      tray.setToolTip(handlers.status())
    }, 140)
  }
  tray.on('click', render)
  render()
  return { tray, render, flash }
}
