export function createLimiter({ limit, windowMs }) {
  const hits = new Map()
  return {
    allow(ip, now = Date.now()) {
      const recent = (hits.get(ip) ?? []).filter((time) => now - time < windowMs)
      if (recent.length >= limit) {
        hits.set(ip, recent)
        return false
      }
      recent.push(now)
      hits.set(ip, recent)
      return true
    }
  }
}
