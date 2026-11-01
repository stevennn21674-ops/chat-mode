import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isKidSafe } from '../src/shared/filter'
import {
  composeLocalLine,
  echoWords,
  LOCAL_TEMPLATE_COUNT,
  LOCAL_WORD_COUNT,
  makeLocalMessages
} from '../src/shared/local-chat'
import { mulberry32 } from './rng'

describe('offline chat generator', () => {
  it('keeps a large kid-friendly catalog and does not mention the network', () => {
    expect(LOCAL_TEMPLATE_COUNT).toBeGreaterThanOrEqual(200)
    expect(LOCAL_WORD_COUNT).toBeGreaterThanOrEqual(200)
    const source = readFileSync(join(import.meta.dirname, '../src/shared/local-chat.ts'), 'utf8')
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toMatch(/https?:/)
  })

  it('echoes safe transcript words and drops blocked ones', () => {
    expect(echoWords(['the dragon is fucking cool'])).toEqual(['dragon', 'cool'])
    expect(echoWords(['hello n1gger'])).toEqual(['hello'])
    const echoed = composeLocalLine({
      rng: () => 0,
      keywords: ['dragon'],
      recent: [],
      screen: null,
      mode: 'echo'
    })
    expect(echoed.toLowerCase()).toContain('dragon')
  })

  it('reacts to cheap screen signals, copies chat, and varies the wording', () => {
    expect(
      composeLocalLine({
        rng: () => 0,
        keywords: [],
        recent: [],
        screen: { change: 0.9, colors: ['red'], title: 'Puzzle Game' },
        mode: 'screen'
      }).toLowerCase()
    ).toContain('red')
    expect(
      composeLocalLine({
        rng: () => 0,
        keywords: [],
        recent: [],
        screen: { change: 0.02, colors: [], title: null },
        mode: 'screen'
      }).toLowerCase()
    ).toContain('nothing')
    expect(
      composeLocalLine({
        rng: () => 0,
        keywords: [],
        recent: [],
        screen: { change: 0.8, colors: [], title: 'Puzzle Game' },
        mode: 'screen'
      })
    ).toContain('Puzzle Game')
    expect(
      composeLocalLine({
        rng: () => 0,
        keywords: [],
        recent: ['pixel: hello chat'],
        screen: null,
        mode: 'copy'
      }).toLowerCase()
    ).toContain('hello chat')
    const caps = composeLocalLine({ rng: () => 0, keywords: [], recent: [], screen: null, mode: 'caps' })
    expect(caps).toBe(caps.toUpperCase())
    const typo = composeLocalLine({ rng: () => 0, keywords: [], recent: [], screen: null, mode: 'typo' })
    expect(typo).not.toBe('wait clip?')
    expect(isKidSafe(typo)).toBe(true)

    const messages = makeLocalMessages({
      count: 24,
      rng: mulberry32(4),
      avoid: new Set<string>(),
      transcripts: ['the dragon appeared'],
      pcAudio: ['treasure chest'],
      recentLines: ['nova: loot'],
      boredom: 0.1,
      roster: [{ name: 'ModMaven', badge: 'mod', color: '#7dffa8' }]
    })
    expect(messages.length).toBe(24)
    expect(new Set(messages.map((message) => message.text)).size).toBeGreaterThan(12)
    expect(messages.every((message) => isKidSafe(message.text) && isKidSafe(message.username))).toBe(true)
    const bored = makeLocalMessages({
      count: 2,
      rng: () => 0,
      avoid: new Set<string>(),
      boredom: 0.9,
      roster: [{ name: 'ModMaven', badge: 'mod', color: '#7dffa8' }]
    })
    expect(bored[0]?.text.toLowerCase()).toMatch(/bored|gn|brb|zzz|dip|sleepy|loop/)
    expect(bored.some((message) => message.badge === 'mod')).toBe(true)
  })
})
