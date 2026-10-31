import { describe, expect, it } from 'vitest'
import { scheduleMessages, takeDue } from '../src/shared/schedule'
import { clampSpeed, delayRangeMs, speedMidpoint, stepSpeed } from '../src/shared/speed'
import type { ChatMessage } from '../src/shared/types'

function message(text: string): ChatMessage {
  return { id: text, username: 'viewer', badge: null, color: '#ffffff', text, kind: 'chat' }
}

describe('speed levels', () => {
  it('steps slower and faster inside the level range', () => {
    expect(stepSpeed(4, 'slower')).toBe(3)
    expect(stepSpeed(4, 'faster')).toBe(5)
    expect(stepSpeed(1, 'slower')).toBe(1)
    expect(stepSpeed(7, 'faster')).toBe(7)
    expect(clampSpeed(Number.NaN)).toBe(4)
    expect(clampSpeed(99)).toBe(7)
  })

  it('uses a slower gap for lower levels', () => {
    const mids = [1, 2, 3, 4, 5, 6, 7].map(speedMidpoint)
    for (let i = 1; i < mids.length; i++) expect(mids[i]).toBeLessThan(mids[i - 1])
    expect(delayRangeMs(1)[0]).toBeGreaterThan(delayRangeMs(7)[1])
  })
})

describe('message scheduling', () => {
  it('spaces messages instead of showing a batch at once', () => {
    const scheduled = scheduleMessages(
      [message('one'), message('two'), message('three')],
      4,
      1000,
      () => 0
    )
    expect(scheduled.map((item) => item.at)).toEqual([1090, 1890, 2690])
    expect(new Set(scheduled.map((item) => item.at)).size).toBe(3)
  })

  it('releases only one due message and staggers the rest', () => {
    const queue = [
      { at: 0, message: message('a') },
      { at: 1, message: message('b') },
      { at: 5000, message: message('c') }
    ]
    const { next, rest } = takeDue(queue, 1000)
    expect(next?.message.text).toBe('a')
    expect(rest.map((item) => item.at)).toEqual([1140, 5000])
    expect(takeDue([{ at: 2000, message: message('later') }], 1000).next).toBeNull()
  })
})
