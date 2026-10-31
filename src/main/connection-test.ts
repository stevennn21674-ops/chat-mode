import { requestCompletion } from '../shared/ai-client'
import { completionsUrlFromBase, usableBaseUrl } from '../shared/service-defaults'

export async function testService(input: { apiKey: string; model: string; baseUrl: string }): Promise<{ ok: boolean; detail: string }> {
  const apiKey = input.apiKey.trim()
  const model = input.model.trim()
  if (!apiKey || !model) return { ok: false, detail: 'Add a key and a model first.' }
  const result = await requestCompletion({
    url: completionsUrlFromBase(usableBaseUrl(input.baseUrl)),
    apiKey,
    model,
    system: 'Reply with exactly the word ok.',
    userText: 'ok',
    imageBase64: null,
    maxTokens: 8,
    timeoutMs: 20000
  })
  if (result.ok) return { ok: true, detail: 'Connection succeeded.' }
  if (result.reason === 'rate_limit') return { ok: false, detail: 'The service is rate limiting. Try again shortly.' }
  if (result.status === 401 || result.status === 403) return { ok: false, detail: 'The service rejected the key.' }
  return { ok: false, detail: 'Could not reach the service.' }
}
