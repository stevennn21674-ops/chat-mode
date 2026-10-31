import { describe, expect, it } from 'vitest'
import { downsample, encodeWavPcm16 } from '../src/shared/audio'
import { parseWhisperStdout } from '../src/shared/whisper'

describe('audio', () => {
  it('downsamples by averaging buckets', () => {
    const input = Float32Array.from([0, 1, 0.5, 0.5])
    expect(Array.from(downsample(input, 2000, 1000))).toEqual([0.5, 0.5])
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
