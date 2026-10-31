const IGNORE =
  /^(whisper_|ggml_|system_info|main:|load_|whisper_print|log_|info:|output_txt|ggml_backend)/i

const HALLUCINATIONS = new Set([
  'thanks for watching',
  'thank you for watching',
  'subtitles by the amara.org community',
  '[music]',
  'music',
  'blank audio',
  '[blank_audio]'
])

export function parseWhisperStdout(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !IGNORE.test(line))
    .filter((line) => !/^\[blank_audio\]$/i.test(line))
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter((line) => line && !line.startsWith('['))
  const text = lines.join(' ').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (HALLUCINATIONS.has(text.toLowerCase())) return ''
  return text
}
