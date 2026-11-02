import { isKidSafe } from './filter'

const HEADERS = { 'user-agent': 'ChatMode/0.4 (local overlay)', accept: 'application/json' }

export function wikiSearchUrl(query: string): string {
  return `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&namespace=0&format=json`
}

export function wikiSummaryUrl(title: string): string {
  return `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`
}

export function allowLookup(stamps: number[], now: number, limit = 3, windowMs = 60_000): boolean {
  const fresh = stamps.filter((stamp) => now - stamp < windowMs)
  stamps.length = 0
  stamps.push(...fresh)
  if (stamps.length >= limit) return false
  stamps.push(now)
  return true
}

export function parseOpenSearch(data: unknown): string | null {
  if (!Array.isArray(data) || !Array.isArray(data[1])) return null
  const title = data[1][0]
  return typeof title === 'string' && title.trim() ? title.trim() : null
}

export function parseSummary(data: unknown): { title: string; extract: string } | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  if (record.type === 'disambiguation') return null
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const extract = typeof record.extract === 'string' ? record.extract.trim() : ''
  if (!title || !extract) return null
  return { title: title.slice(0, 80), extract: extract.slice(0, 180) }
}

export function safeFact(title: string, extract: string): string | null {
  const fact = `${title}. ${extract}`.replace(/\s+/g, ' ').trim().slice(0, 180)
  if (!isKidSafe(fact) || !isKidSafe(title)) return null
  return fact
}

export async function fetchWikiFact(
  query: string,
  fetchFn: typeof fetch,
  timeoutMs = 4000
): Promise<string | null> {
  const name = query.trim().slice(0, 80)
  if (name.length < 3 || !isKidSafe(name)) return null
  try {
    const search = await fetchFn(wikiSearchUrl(name), { signal: AbortSignal.timeout(timeoutMs), headers: HEADERS })
    if (!search.ok) return null
    const title = parseOpenSearch(await search.json())
    if (!title || !isKidSafe(title)) return null
    const summary = await fetchFn(wikiSummaryUrl(title), { signal: AbortSignal.timeout(timeoutMs), headers: HEADERS })
    if (!summary.ok) return null
    const parsed = parseSummary(await summary.json())
    if (!parsed) return null
    return safeFact(parsed.title, parsed.extract)
  } catch {
    return null
  }
}
