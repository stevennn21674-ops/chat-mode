export function createLimiter(options: { limit: number; windowMs: number }): {
  allow(ip: string, now?: number): boolean
}
