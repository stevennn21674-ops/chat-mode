import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { parseWhisperStdout } from '../shared/whisper'

export function transcribeFile(bin: string, model: string, wavPath: string, timeoutMs = 30000): Promise<string> {
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
