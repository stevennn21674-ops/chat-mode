export function resolveCompletionsUrl(proxyBase: string, directEndpoint: string): string {
  if (!proxyBase) return directEndpoint
  if (/\/chat\/completions\/?$/i.test(proxyBase)) return proxyBase
  return `${proxyBase.replace(/\/$/, '')}/v1/chat/completions`
}

export function nextBackoff(current: number, failed: boolean, retryAfterMs?: number): number {
  if (!failed) return 0
  const base = current <= 0 ? 15000 : Math.min(120000, current * 2)
  if (retryAfterMs && Number.isFinite(retryAfterMs) && retryAfterMs > base) {
    return Math.min(120000, retryAfterMs)
  }
  return base
}

export function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const date = Date.parse(header)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return undefined
}
