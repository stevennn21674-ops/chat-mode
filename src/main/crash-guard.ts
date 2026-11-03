type ErrorDialog = { showErrorBox: (title: string, content: string) => void }

let notify: (line: string) => void = (line) => {
  console.error(`[chat-mode] ${line}`)
}

export function setCrashNotify(fn: (line: string) => void): void {
  notify = fn
}

function report(line: string): void {
  const text = line.replace(/\s+/g, ' ').trim().slice(0, 500)
  try {
    notify(text || 'unknown error')
  } catch {
    console.error('[chat-mode]', text)
  }
}

export function installCrashGuard(dialogApi: ErrorDialog): void {
  dialogApi.showErrorBox = (title, content) => {
    report(`${title}: ${content}`)
  }
  process.on('uncaughtException', (error) => {
    report(error instanceof Error ? error.stack || error.message : String(error))
  })
  process.on('unhandledRejection', (reason) => {
    report(reason instanceof Error ? reason.stack || reason.message : String(reason))
  })
}
