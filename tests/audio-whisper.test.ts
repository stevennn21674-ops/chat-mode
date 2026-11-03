import { describe, expect, it } from 'vitest'
import { asFloat32, downsample, encodeWavPcm16, isSilentPcm, PcmWindow, trimSilence } from '../src/shared/audio'
import { parseWhisperStdout } from '../src/shared/whisper'

describe('audio', () => {
  it('downsamples by averaging buckets', () => {
    const input = Float32Array.from([0, 1, 0.5, 0.5])
    expect(Array.from(downsample(input, 2000, 1000))).toEqual([0.5, 0.5])
  })

  it('keeps the last 18 seconds and treats silence as skippable', () => {
    const window = new PcmWindow(18)
    window.push(Float32Array.from({ length: 16000 }, () => 0), 16000)
    window.push(Float32Array.from({ length: 16000 * 20 }, () => 0.2), 16000)
    const snap = window.snapshot()
    expect(snap?.sampleRate).toBe(16000)
    expect(snap?.samples.length).toBe(16000 * 18)
    expect(isSilentPcm(Float32Array.from({ length: 1600 }, () => 0))).toBe(true)
    expect(isSilentPcm(Float32Array.from({ length: 1600 }, () => 0.2))).toBe(false)
  })

  it('trims silence and accepts float bytes from the mic path', () => {
    const quiet = new Float32Array(8000)
    const loud = Float32Array.from({ length: 1600 }, () => 0.2)
    const clip = new Float32Array(quiet.length + loud.length + quiet.length)
    clip.set(loud, quiet.length)
    const trimmed = trimSilence(clip, 16000)
    expect(trimmed.length).toBeGreaterThan(1000)
    expect(trimmed.length).toBeLessThan(clip.length)
    expect(trimSilence(quiet, 16000).length).toBe(0)
    const bytes = new Uint8Array(loud.buffer.slice(0))
    const restored = asFloat32(bytes, 'f32le')
    expect(restored?.[0]).toBeCloseTo(0.2)
    expect(asFloat32([0.25, -0.5])?.[1]).toBeCloseTo(-0.5)
  })

  it('writes a 16-bit wav header', () => {
    const wav = encodeWavPcm16(Float32Array.from([0, 1, -1]), 16000)
    expect(wav.subarray(0, 4).toString('utf8')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('utf8')).toBe('WAVE')
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(wav.readInt16LE(44 + 2)).toBe(32767)
    expect(wav.readInt16LE(44 + 4)).toBe(-32768)
  })
})

describe('whisper output', () => {
  it('keeps the transcript and drops logs and hallucinations', () => {
    const stdout = [
      "whisper_init_from_file_with_params_no_state: loading model",
      'system_info: n_threads = 4',
      '[00:00:00.000 --> 00:00:01.200]   nice shot',
      ''
    ].join('\n')
    expect(parseWhisperStdout(stdout)).toBe('nice shot')
    expect(parseWhisperStdout('thanks for watching')).toBe('')
    expect(parseWhisperStdout('[BLANK_AUDIO]')).toBe('')
  })
})
