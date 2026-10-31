import { redact } from '../shared/redact'

export function log(message: string): void {
  console.log(`[chat-mode] ${redact(message)}`)
}
