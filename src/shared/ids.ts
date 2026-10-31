export function makeId(now: number, rng: () => number): string {
  const n = Math.floor(rng() * 0xffffffff)
    .toString(16)
    .padStart(8, '0')
  return `${now.toString(36)}-${n}`
}
