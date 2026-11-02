import { contextBridge, ipcRenderer } from 'electron'
import type { CustomCrowd } from '../shared/custom-viewers'
import type { MicDevice, SettingsView } from '../shared/types'

contextBridge.exposeInMainWorld('settings', {
  get(): Promise<SettingsView> {
    return ipcRenderer.invoke('settings:get')
  },
  update(patch: Partial<SettingsView>): Promise<SettingsView> {
    return ipcRenderer.invoke('settings:update', patch)
  },
  resetPosition(): Promise<SettingsView> {
    return ipcRenderer.invoke('settings:reset')
  },
  listMics(): Promise<MicDevice[]> {
    return ipcRenderer.invoke('settings:mics')
  },
  setKey(key: string): Promise<SettingsView> {
    return ipcRenderer.invoke('settings:set-key', key)
  },
  test(draft: { apiKey: string; model: string; baseUrl: string }): Promise<{ ok: boolean; detail: string }> {
    return ipcRenderer.invoke('settings:test', draft)
  },
  customGet(): Promise<CustomCrowd> {
    return ipcRenderer.invoke('custom:get')
  },
  customSet(crowd: CustomCrowd): Promise<CustomCrowd> {
    return ipcRenderer.invoke('custom:set', crowd)
  },
  customExport(): Promise<boolean> {
    return ipcRenderer.invoke('custom:export')
  },
  customImport(): Promise<CustomCrowd> {
    return ipcRenderer.invoke('custom:import')
  },
  onChange(callback: (view: SettingsView) => void): () => void {
    const listener = (_event: unknown, view: SettingsView): void => callback(view)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  }
})
