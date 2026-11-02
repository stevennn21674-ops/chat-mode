import { describe, expect, it } from 'vitest'
import { buildBrainPrompt, modelSpec, paceFor, polishBrainLines } from '../src/shared/brain'
import { jokeLine, offlineReply, replyToViewer } from '../src/shared/nlu'
import { activityLines } from '../src/shared/screen-activity'
import type { ChatMessage } from '../src/shared/types'

function line(text: string, username = 'Nova'): ChatMessage {
  return { id: text, username, badge: null, color: '#ffffff', text, kind: 'chat' }
}

describe('offline replies', () => {
  it('answers sample lines from the words that were actually said', () => {
    expect(offlineReply('where is the exit')).toMatch(/exit/i)
    expect(offlineReply('chat should we hide')).toMatch(/hide/i)
    expect(offlineReply('we won')).toMatch(/GG|W|LETS|huge/i)
    expect(offlineReply('hello')).toMatch(/hey|hello|hi|yo/i)
    expect(offlineReply('what game is this', { game: 'Minecraft' })).toBe('this is Minecraft')
    expect(offlineReply('nova nice shot', { names: ['NovaByte'] })).toMatch(/NovaByte/)
    expect(jokeLine('dragon')).toBe('the dragon arc continues')
    expect(jokeLine('dragon')).toBe(jokeLine('dragon'))
    expect(replyToViewer('Pixel: where is the door?', () => 0)).toMatch(/Pixel/)
    expect(replyToViewer('Pixel: where is the door?', () => 0)).toMatch(/door/)
    expect(activityLines('scare', null)[0]).toBe('WAIT WHAT WAS THAT')
  })

  it('drops repeats and keeps the brain prompt on the scene', () => {
    const kept = polishBrainLines(
      [line('the red key'), line('the red key'), line('what the fuck'), line('boss music')],
      ['the red key'],
      'red key'
    )
    expect(kept.map((message) => message.text)).toEqual([])
    const fresh = polishBrainLines([line('check the door')], ['Nova: hi'], 'door')
    expect(fresh.map((message) => message.text)).toEqual(['check the door'])
    const prompt = buildBrainPrompt(
      {
        transcripts: ['where is the exit'],
        pcAudio: ['a door opened'],
        recentLines: ['Nova: hi'],
        windowTitle: 'Minecraft',
        context: 'Heard: a door',
        customBlock: '',
        boredom: 0.2,
        viewerCount: 10,
        avoid: [],
        now: 1,
        rng: () => 0,
        activity: 'Steady motion on the screen.',
        liveLines: ['RealFan: the door'],
        joke: 'door'
      },
      paceFor('normal')
    )
    expect(prompt.user).toContain('where is the exit')
    expect(prompt.user).toContain('Steady motion')
    expect(prompt.user).toContain('RealFan: the door')
    expect(prompt.user).toContain('door arc continues')
    expect(prompt.system).toContain('Example:')
    expect(prompt.system).toContain('Do not invent')
    const smart = modelSpec('smart')
    expect(smart.bundled).toBe(false)
    expect(smart.family).toBe('Qwen2.5-1.5B-Instruct')
    expect(smart.bytes).toBe(1117320736)
    expect(smart.sha256).toHaveLength(64)
    expect(smart.bytes).toBeGreaterThan(modelSpec('medium').bytes)
  })
})
