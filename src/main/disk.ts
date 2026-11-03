import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export function directoryBytes(root: string): number {
  if (!existsSync(root)) return 0
  let total = 0
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    try {
      const stat = statSync(path)
      total += stat.isDirectory() ? directoryBytes(path) : stat.size
    } catch {
      // A file disappeared while it was being measured.
    }
  }
  return total
}

export function fileBytes(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
