import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { parseWhisperStdout } from '../shared/whisper'

let tail: Promise<void> = Promise.resolve()

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job)
  tail = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export function transcribeFile(bin: string, model: string, wavPath: string, timeoutMs = 30000): Promise<string> {
  return enqueue(() => transcribeNow(bin, model, wavPath, timeoutMs))
}

function transcribeNow(bin: string, model: string, wavPath: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-m', model, '-f', wavPath, '-l', 'en', '-nt', '-t', '4'], {
      cwd: dirname(bin),
      windowsHide: true
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('transcription timed out'))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const text = parseWhisperStdout(`${out}\n${err}`)
      if (code !== 0 && !text) reject(new Error('transcription failed'))
      else resolve(text)
    })
  })
}
