import { appendFileSync } from 'node:fs'
import { redact } from '../shared/redact'

const voiceDebug = { file: '' }

export function setVoiceDebugFile(file: string): void {
  voiceDebug.file = file
}

export function log(message: string): void {
  console.log(`[chat-mode] ${redact(message)}`)
}

export function logVoiceDebug(line: string): void {
  if (!voiceDebug.file) return
  const text = redact(line).replace(/[\r\n]+/g, ' ').slice(0, 240)
  try {
    appendFileSync(voiceDebug.file, `${new Date().toISOString()} ${text}\n`)
  } catch {
    // The debug file is optional.
  }
}
