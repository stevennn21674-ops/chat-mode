import { describe, expect, it } from 'vitest'
import { alertIntervalMs, allowSyntheticChat, rollAlert, sampleDonation, viewerBumpFor } from '../src/shared/alerts'
import { isKidSafe, maskBadWords } from '../src/shared/filter'
import { synthTone } from '../src/shared/tones'

describe('alerts', () => {
  it('builds a kid-friendly donation inside the amount range', () => {
    const alert = rollAlert({ min: 4, max: 9, currency: '$', sound: 'coin', tts: false, rng: () => 0.05, now: 10, avoid: new Set() })
    expect(alert.message.kind).toBe('donation')
    expect(alert.message.amount).toMatch(/^\$[4-9]$/)
    expect(isKidSafe(alert.message.text)).toBe(true)
    expect(isKidSafe(alert.message.username)).toBe(true)
    expect(alert.reactions.some((line) => /POG|thank you for the donation/i.test(line.text))).toBe(true)
    expect(alert.viewerBump).toBeGreaterThan(0)
    expect(alert.speak).toBeNull()
    const spoken = sampleDonation('$', 'chime', true)
    expect(spoken.speak).toMatch(/TestDonor/)
    expect(isKidSafe(spoken.speak ?? '')).toBe(true)
  })

  it('spaces rare alerts further apart than often', () => {
    expect(alertIntervalMs('rare', () => 0)).toBeGreaterThan(alertIntervalMs('often', () => 0))
    expect(viewerBumpFor('raid', 0, 40)).toBe(40)
    expect(allowSyntheticChat('real', true)).toBe(false)
    expect(allowSyntheticChat('mixed', true)).toBe(true)
    expect(maskBadWords('what the fuck')).toBe('what the ****')
  })

  it('synthesizes different original tones', () => {
    const coin = synthTone('coin', 'donation')
    const horn = synthTone('horn', 'raid')
    expect(String.fromCharCode(coin[0] ?? 0, coin[1] ?? 0, coin[2] ?? 0, coin[3] ?? 0)).toBe('RIFF')
    expect(coin.length).toBeGreaterThan(1000)
    expect(coin.length).not.toBe(horn.length)
    let loud = 0
    for (let i = 44; i < coin.length; i += 2) {
      const sample = coin[i]! | (coin[i + 1]! << 8)
      if (sample > 1000 && sample < 65000) loud += 1
    }
    expect(loud).toBeGreaterThan(10)
  })
})
