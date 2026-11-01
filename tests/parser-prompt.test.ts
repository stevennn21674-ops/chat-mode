import { describe, expect, it } from 'vitest'
import { parseModelOutput } from '../src/shared/parser'
import { buildSystemPrompt, buildUserText, SLANG_TERMS } from '../src/shared/prompt'
import { mulberry32 } from './rng'

const ctx = () => ({ now: 10, rng: mulberry32(3), avoid: new Set<string>(['taken']) })

describe('model output parser', () => {
  it('reads fenced JSON, arrays, and extra prose', () => {
    const fenced = 'Sure\n```json\n{"messages":[{"username":"pixel_fox","badge":"vip","message":"nice shot","color":"#ff88cc","kind":"chat"}]}\n```\nthanks'
    const parsed = parseModelOutput(fenced, ctx())
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ username: 'pixel_fox', badge: 'vip', text: 'nice shot', color: '#ff88cc' })

    const array = parseModelOutput('here [{"username":"moth_byte","message":"hmm","badge":"moderator"}] trailing', ctx())
    expect(array[0]).toMatchObject({ username: 'moth_byte', badge: 'mod', text: 'hmm' })

    const wrapped = parseModelOutput(JSON.stringify({ chat: [{ name: 'cedar_pine', text: 'ok' }] }), ctx())
    expect(wrapped[0]?.text).toBe('ok')
  })

  it('drops broken items and replaces unsafe or dark colors', () => {
    const raw = JSON.stringify({
      messages: [
        { username: 'x', message: 'hello there' },
        { username: 'taken', message: 'second line' },
        { message: '' },
        'nope',
        { username: 'amber_fox', message: 'bright', color: '#112233' }
      ]
    })
    const parsed = parseModelOutput(raw, ctx())
    expect(parsed.map((item) => item.text)).toEqual(['hello there', 'second line', 'bright'])
    expect(parsed[0]?.username).not.toBe('x')
    expect(parsed[1]?.username.toLowerCase()).not.toBe('taken')
    expect(parsed[2]?.color).not.toBe('#112233')
  })

  it('unwraps a double-encoded payload', () => {
    const inner = JSON.stringify({ messages: [{ username: 'orbit_lane', message: 'menu moment' }] })
    const parsed = parseModelOutput(JSON.stringify(inner), ctx())
    expect(parsed[0]?.text).toBe('menu moment')
  })
})

describe('system prompt', () => {
  it('includes slang and tells the model to use it naturally and sparingly', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('Use this slang naturally and sparingly.')
    expect(prompt.toLowerCase()).toContain('kid-friendly')
    expect(prompt).toContain('excited')
    expect(prompt).toContain('quiet lurker')
    for (const term of SLANG_TERMS) expect(prompt).toContain(term)
    expect(prompt.toLowerCase()).not.toContain('agnes')
    expect(prompt).toContain('as if they are looking at it live')
    expect(prompt).toContain('never mention screenshots, screen captures, AI')
  })

  it('talks about the screen and computer audio without calling them a screenshot', () => {
    const seen = buildUserText({
      transcripts: [],
      recentLines: [],
      avoidUsernames: [],
      batchCount: 4,
      hasImage: true,
      pcAudio: ['the boss yelled']
    })
    expect(seen).toContain('Audio on the PC')
    expect(seen).toContain('the boss yelled')
    expect(seen.toLowerCase()).not.toContain('screenshot')
    const unseen = buildUserText({
      transcripts: ['hello'],
      recentLines: [],
      avoidUsernames: [],
      batchCount: 2,
      hasImage: false
    })
    expect(unseen).toContain('Do not invent what is on the screen')
    expect(unseen.toLowerCase()).not.toContain('screenshot')
  })
})
