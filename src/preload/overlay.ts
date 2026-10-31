import { contextBridge, ipcRenderer } from 'electron'
import type { ChatMessage, OverlayState, PointerEventPayload } from '../shared/types'

contextBridge.exposeInMainWorld('chat', {
  ready(): void {
    ipcRenderer.send('overlay:ready')
  },
  setIgnoreMouse(ignore: boolean): void {
    ipcRenderer.send('overlay:ignore', ignore)
  },
  pointer(payload: PointerEventPayload): void {
    ipcRenderer.send('overlay:pointer', payload)
  },
  onMessage(callback: (message: ChatMessage) => void): () => void {
    const listener = (_event: unknown, message: ChatMessage): void => callback(message)
    ipcRenderer.on('overlay:message', listener)
    return () => ipcRenderer.removeListener('overlay:message', listener)
  },
  onState(callback: (state: OverlayState) => void): () => void {
    const listener = (_event: unknown, state: OverlayState): void => callback(state)
    ipcRenderer.on('overlay:state', listener)
    return () => ipcRenderer.removeListener('overlay:state', listener)
  }
})
