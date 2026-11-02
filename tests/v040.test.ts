import { describe, expect, it } from 'vitest'
import { isLoudPcm } from '../src/shared/audio'
import { banViewer, createCrowd, isBanned, tickCrowd } from '../src/shared/crowd'
import {
  addHaters,
  customPromptBlock,
  haterPreset,
  sanitizeCrowd,
  viewerLine
} from '../src/shared/custom-viewers'
import { isKidSafe } from '../src/shared/filter'
import { compactContext, createKnowledge, ingest, lookupCandidate } from '../src/shared/knowledge'
import { makeLocalMessages } from '../src/shared/local-chat'
import { allowLookup, fetchWikiFact, parseOpenSearch, parseSummary, safeFact } from '../src/shared/lookup'
import {
  buildMassBan,
  mergeChatters,
  nameKey,
  parseModCommand,
  phoneticKey,
  resolveModTargets
} from '../src/shared/moderation'
import { effectivelyOffline } from '../src/shared/net'
import {
  columnWord,
  createMemory,
  detectIntent,
  letterSpam,
  noteText,
  nluLine,
  recentTopics,
  stretchWord
} from '../src/shared/nlu'
import { isMostlyBlack } from '../src/shared/screen-cues'
import { applyPatch, DEFAULT_SETTINGS } from '../src/shared/settings'

describe('voice bans', () => {
  const chatters = [
    { name: 'xX_PixelFox99', spam: 0, recentIndex: 1 },
    { name: 'NovaByte', spam: 0, recentIndex: 2 },
    { name: 'loud_lurker', spam: 4, recentIndex: 3 },
    { name: 'GreenSword', spam: 0, recentIndex: 4, mod: true }
  ]

  it('matches decorative names, pronouns, and everyone', () => {
    expect(nameKey('xX_PixelFox99')).toBe('pixelfox')
    expect(phoneticKey('NovaByte')).toBe(phoneticKey('nova bite'))
    expect(resolveModTargets(parseModCommand('ban pixel fox')!, chatters)).toEqual(['xX_PixelFox99'])
    expect(resolveModTargets(parseModCommand('ban the last guy')!, chatters)).toEqual(['loud_lurker'])
    expect(parseModCommand('ban all the bots')?.target).toBe('everyone')
    expect(parseModCommand('mods ban everyone')?.target).toBe('everyone')
    const everyone = resolveModTargets(parseModCommand('ban everyone')!, chatters)
    expect(everyone).not.toContain('GreenSword')
    expect(everyone).toContain('loud_lurker')
    const pool = mergeChatters([chatters, [{ name: 'CustomMod', spam: 0, recentIndex: -1, mod: true }]])
    expect(resolveModTargets(parseModCommand('ban him')!, pool)).toEqual(['loud_lurker'])
    expect(resolveModTargets(parseModCommand('ban custom mod')!, pool)).toEqual(['CustomMod'])
    const lines = buildMassBan({ targets: ['NovaByte', 'loud_lurker'], modName: 'CustomMod', rng: () => 0, now: 3 })
    expect(lines.map((line) => line.text)).toEqual(['banned everyone', 'NovaByte has been banned', 'loud_lurker has been banned'])
    expect(lines[1]?.purgeUser).toBe('NovaByte')
  })

  it('remembers a ban so that viewer does not rejoin', () => {
    const crowd = createCrowd(() => 0.2, 0)
    const name = crowd.viewers[0]?.name ?? 'pixel_fox'
    const start = crowd.count
    banViewer(crowd, name)
    expect(isBanned(crowd, name)).toBe(true)
    expect(crowd.viewers.some((viewer) => viewer.name === name)).toBe(false)
    expect(crowd.count).toBe(start - 1)
    tickCrowd(crowd, { now: 20_000, idle: false, micLive: true, rng: () => 0 })
    expect(crowd.viewers.some((viewer) => viewer.name.toLowerCase() === name.toLowerCase())).toBe(false)
  })
})

describe('local understanding', () => {
  it('tracks words, intents, and chatty shapes', () => {
    const memory = createMemory()
    noteText(memory, 'the dragon dragon dragon is scary', 0)
    expect(memory.terms.get('the')?.count).toBe(1)
    expect(memory.terms.get('dragon')?.count).toBe(3)
    expect(memory.joke).toBe('dragon')
    expect(recentTopics(memory, 0)).toContain('dragon')
    expect(recentTopics(memory, 21 * 60 * 1000)).toEqual([])
    expect(detectIntent('what is this level').intent).toBe('question')
    expect(detectIntent('the smiler').intent).toBe('scare')
    expect(detectIntent('hello chat').intent).toBe('greeting')
    expect(detectIntent('chat what should I do').intent).toBe('ask-chat')
    expect(detectIntent('I died').intent).toBe('lose')
    expect(detectIntent('we won').intent).toBe('win')
    expect(detectIntent('ok', { loud: true }).intent).toBe('scare')
    expect(detectIntent('nova nice shot', { names: ['NovaByte'] }).intent).toBe('name')
    expect(letterSpam('win')).toBe('W W W W')
    expect(columnWord('win')).toBe('W\nI\nN')
    expect(stretchWord('go').length).toBeGreaterThan(3)
    const scare = nluLine({ rng: () => 0, intent: 'scare', keywords: ['smiler'] })
    expect(scare).toMatch(/LETS GOOO|NOOO|RUN|BEHIND YOU/)
    expect(isKidSafe(scare)).toBe(true)
    const messages = makeLocalMessages({
      count: 3,
      rng: () => 0.1,
      avoid: new Set<string>(),
      transcripts: ['we won the run'],
      intent: 'win',
      boredom: 0
    })
    expect(messages.every((message) => isKidSafe(message.text))).toBe(true)
    expect(messages.some((message) => /GG|LETS|W|huge/i.test(message.text))).toBe(true)
  })

  it('remembers entities from pc audio and titles', () => {
    const knowledge = createKnowledge()
    ingest(knowledge, 'The Smiler is in the backrooms', 'pc', 10)
    ingest(knowledge, 'Escape the Backrooms', 'title', 20)
    expect(knowledge.entities.some((entity) => entity.name.toLowerCase() === 'smiler')).toBe(true)
    expect(knowledge.events.some((event) => event.label === 'scared')).toBe(true)
    expect(compactContext(knowledge, 30)).toMatch(/Smiler|smiler|backrooms/i)
    expect(lookupCandidate(knowledge, new Set())).toBeTruthy()
    expect(isLoudPcm(Float32Array.from({ length: 20 }, () => 0.4))).toBe(true)
    expect(isMostlyBlack(new Uint8Array(64))).toBe(true)
    expect(isMostlyBlack(new Uint8Array(64).fill(200))).toBe(false)
  })
})

describe('lookups, offline, and custom viewers', () => {
  it('rate limits wikipedia facts and fails closed', async () => {
    const stamps: number[] = []
    expect(allowLookup(stamps, 0)).toBe(true)
    expect(allowLookup(stamps, 10)).toBe(true)
    expect(allowLookup(stamps, 20)).toBe(true)
    expect(allowLookup(stamps, 30)).toBe(false)
    expect(parseOpenSearch(['backrooms', ['Backrooms'], [], []])).toBe('Backrooms')
    expect(parseSummary({ title: 'Backrooms', extract: 'A creepypasta place.', type: 'standard' })?.title).toBe('Backrooms')
    expect(safeFact('Backrooms', 'fuck')).toBeNull()
    const fact = await fetchWikiFact('Backrooms', (async () => ({
      ok: true,
      json: async () => ({ title: 'Backrooms', extract: 'A liminal creepypasta setting.', type: 'standard' })
    })) as unknown as typeof fetch)
    expect(fact).toBeNull()
    const searched = await fetchWikiFact('Backrooms', (async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes('opensearch')
        ? ['Backrooms', ['Backrooms'], [], []]
        : { title: 'Backrooms', extract: 'A liminal creepypasta setting.', type: 'standard' })
    })) as unknown as typeof fetch)
    expect(searched).toMatch(/Backrooms/)
    expect(isKidSafe(searched ?? '')).toBe(true)
    expect(effectivelyOffline(false, true)).toBe(false)
    expect(effectivelyOffline(true, true)).toBe(true)
    expect(effectivelyOffline(false, false)).toBe(true)
    const settings = applyPatch(DEFAULT_SETTINGS, { offlineMode: true, overlayMode: 'game', showDebugTranscript: true })
    expect(settings.offlineMode).toBe(true)
    expect(settings.overlayMode).toBe('game')
    expect(settings.showDebugTranscript).toBe(true)
  })

  it('keeps custom viewers kid-friendly and in character', () => {
    const cleaned = sanitizeCrowd({
      viewers: [{ id: 'a', username: 'NiceMod', role: 'mod', phrases: ['on it', 'fuck off'], description: 'keeps chat kind' }],
      randomNames: ['cool_pal', 'no']
    })
    expect(cleaned.viewers[0]?.phrases).toEqual(['on it'])
    expect(cleaned.viewers[0]?.role).toBe('mod')
    expect(cleaned.randomNames).toEqual(['cool_pal'])
    expect(haterPreset().every((viewer) => viewer.role === 'hater' && isKidSafe(viewer.username) && viewer.phrases.every((phrase) => isKidSafe(phrase)))).toBe(true)
    const withHaters = addHaters(cleaned)
    expect(withHaters.viewers.length).toBeGreaterThan(cleaned.viewers.length)
    expect(addHaters(withHaters).viewers.length).toBe(withHaters.viewers.length)
    const line = viewerLine(
      { ...haterPreset()[0], phrases: ['that was mid'], trolling: 0, caps: 0, emoji: 0, slang: 0, hype: 0 },
      () => 0,
      []
    )
    expect(line).toBe('that was mid')
    expect(customPromptBlock(cleaned.viewers, cleaned.randomNames)).toContain('NiceMod')
    const spoken = makeLocalMessages({
      count: 1,
      rng: () => 0,
      avoid: new Set<string>(),
      custom: [{ ...cleaned.viewers[0], phrases: ['on it'], talkativeness: 80, presence: 80 }],
      boredom: 0
    })
    expect(spoken[0]?.username).toBe('NiceMod')
    expect(spoken[0]?.badge).toBe('mod')
    expect(spoken[0]?.text.toLowerCase()).toContain('on it')
  })
})
