import { describe, expect, it } from 'vitest'
import { makeFallbackMessages } from '../src/shared/fallback'
import { isKidSafe } from '../src/shared/filter'
import { mulberry32 } from './rng'

const allowed = [
  'lock in that was peak',
  'lowkey cooked',
  'absolute cinema',
  'we are so back',
  'chat is this real',
  'skill issue but nice try',
  'let him cook',
  'aura loss lol',
  'six seven',
  'icl that was clean',
  "the math ain't mathing",
  'understood the assignment',
  'touch grass',
  'nice shot',
  'what boss is this',
  'gg',
  'peacock crossed the road',
  'analysis of that fight',
  'classic menu',
  'cocktail of buffs',
  'shift left',
  'I am dead laughing',
  'the titan is huge',
  'you suck at this boss',
  'this boss sucks',
  'niggle the timing',
  'raccoon in the corner',
  'spice on the food',
  'fagin is a name in a book',
  'document the route',
  'Essex looks foggy',
  '😂😂',
  '...'
]

const blocked = [
  'nigger',
  'n1gg3r',
  'n i g g e r',
  'niiiiggger',
  'faggot',
  'f@g',
  'kill yourself',
  'kys',
  'k.y.s',
  'this is porn',
  'send nudes',
  'gyatt',
  'hawk tuah',
  'sh1t',
  'f u c k',
  'https://example.com',
  'call 555-123-4567'
]

describe('kid-friendly filter', () => {
  it('allows normal chat, game talk, and slang', () => {
    for (const line of allowed) expect(isKidSafe(line), line).toBe(true)
  })

  it('blocks slurs, sexual content, links, and self-harm', () => {
    for (const line of blocked) expect(isKidSafe(line), line).toBe(false)
  })

  it('keeps generated fallback lines safe', () => {
    const lines = makeFallbackMessages(30, mulberry32(7), new Set())
    expect(lines.length).toBe(30)
    for (const line of lines) {
      expect(isKidSafe(line.text)).toBe(true)
      expect(isKidSafe(line.username)).toBe(true)
    }
  })
})
