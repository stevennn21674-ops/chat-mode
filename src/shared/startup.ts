/**
 * Startup flags are initialized here, before any reader runs.
 * Do not add a `let` above STARTUP_STATE, and do not read it from
 * code that runs while this module is still evaluating.
 */
export const STARTUP_STATE = {
  aiModeDefault: false
}

export function startupStateReady(): boolean {
  return typeof STARTUP_STATE.aiModeDefault === 'boolean'
}

export function findTopLevelLetUseBeforeInit(source: string): string[] {
  const lines = source.split(/\r?\n/)
  const decls: { name: string; line: number }[] = []
  const functions = new Map<string, { start: number; body: string }>()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/^\s/.test(line)) continue
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    const letMatch = trimmed.match(/^(?:export\s+)?let\s+([A-Za-z_$][\w$]*)/)
    if (letMatch?.[1]) decls.push({ name: letMatch[1], line: i })
    const fn = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
    if (fn?.[1]) {
      const body: string[] = []
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j] ?? ''
        if (next.trim() && !/^\s/.test(next)) break
        body.push(next)
      }
      functions.set(fn[1], { start: i, body: body.join('\n') })
    }
  }
  const problems: string[] = []
  for (const decl of decls) {
    const pattern = new RegExp(`\\b${decl.name}\\b`)
    for (let i = 0; i < decl.line; i++) {
      const line = lines[i] ?? ''
      if (/^\s/.test(line)) continue
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
      if (pattern.test(trimmed)) {
        problems.push(decl.name)
        continue
      }
      const call = trimmed.match(/^([A-Za-z_$][\w$]*)\s*\(/)
      const fn = call?.[1] ? functions.get(call[1]) : undefined
      if (fn && fn.start > decl.line && pattern.test(fn.body)) problems.push(decl.name)
    }
  }
  return problems
}
