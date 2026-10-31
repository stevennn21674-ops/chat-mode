import { makeFallbackMessages } from './fallback'

export function demoModelJson(rng: () => number = Math.random): string {
  const avoid = new Set<string>()
  const messages = makeFallbackMessages(5, rng, avoid)
  return JSON.stringify({
    messages: messages.map((message) => ({
      username: message.username,
      badge: message.badge,
      message: message.text,
      color: message.color,
      kind: message.kind
    }))
  })
}
