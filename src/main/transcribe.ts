import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { parseWhisperStdout } from '../shared/whisper'

interface Job {
  run: () => Promise<string>
  resolve: (text: string) => void
  reject: (error: unknown) => void
}

let running = false
const mic: Job[] = []
const rest: Job[] = []

function pump(): void {
  if (running) return
  const job = mic.shift() ?? rest.shift()
  if (!job) return
  running = true
  job.run().then(job.resolve, job.reject).finally(() => {
    running = false
    pump()
  })
}

export function transcribeFile(bin: string, model: string, wavPath: string, timeoutMs = 30000, priority = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const job: Job = {
      run: () => transcribeNow(bin, model, wavPath, timeoutMs),
      resolve,
      reject
    }
    if (priority) mic.push(job)
    else rest.push(job)
    pump()
  })
}

function transcribeNow(bin: string, model: string, wavPath: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-m', model, '-f', wavPath, '-l', 'en', '-nt', '-t', '2'], {
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
      if (code !== 0 && !text) {
        const detail = err.replace(/\s+/g, ' ').trim().slice(0, 160)
        reject(new Error(detail || 'transcription failed'))
      } else resolve(text)
    })
  })
}
